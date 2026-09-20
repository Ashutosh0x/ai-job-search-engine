"use client"

import { useState, useRef } from "react"
import { Upload, FileText, Check, AlertTriangle, Play, X, Download, Loader2, Lightbulb } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { DiscoveredEmail } from "@/lib/contacts/types"
import { isObserved } from "@/lib/contacts/normalize"
import { downloadExport, readError } from "@/lib/contacts/client"

/** The API caps a single bulk request at 50 profiles. */
const BATCH_SIZE = 50

interface ParsedContact {
  firstName: string;
  lastName: string;
  company: string;
  domain?: string;
  linkedinUrl?: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  emails?: DiscoveredEmail[];
  savedId?: string | null;
  error?: string;
}

interface BulkUploadProps {
  /** Fires once the run finishes so the dashboard can refresh its counts. */
  onComplete?: () => void;
}

/**
 * Split one CSV line, honouring double-quoted fields.
 *
 * A plain `split(",")` corrupts any row with a comma inside a quoted value —
 * "Smith, Jr." would shift every later column by one and silently discover the
 * wrong person.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields.map((f) => f.trim())
}

export function BulkUpload({ onComplete }: BulkUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [contacts, setContacts] = useState<ParsedContact[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [finished, setFinished] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) processFile(e.dataTransfer.files[0])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) processFile(e.target.files[0])
  }

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error("Please upload a CSV file")
      return
    }

    setFile(file)
    setFinished(false)
    setProgress(0)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) ?? ""
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
        if (lines.length === 0) {
          toast.error("That CSV is empty")
          setContacts([])
          return
        }

        const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
        const hasHeader = header.some((h) => h.includes("first"))
        const columnOf = (...names: string[]) => {
          if (!hasHeader) return -1
          return header.findIndex((h) => names.some((n) => h.replace(/[\s_]/g, "") === n))
        }

        const firstIdx = hasHeader ? Math.max(columnOf("firstname", "first"), 0) : 0
        const lastIdx = hasHeader ? Math.max(columnOf("lastname", "last"), 1) : 1
        const companyIdx = hasHeader ? Math.max(columnOf("company", "employer"), 2) : 2
        const domainIdx = columnOf("domain", "website")
        const linkedinIdx = columnOf("linkedin", "linkedinurl", "profile")

        const parsed: ParsedContact[] = []
        const skipped: number[] = []

        for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
          const parts = splitCsvLine(lines[i])
          const firstName = parts[firstIdx] ?? ""
          const lastName = parts[lastIdx] ?? ""
          const company = parts[companyIdx] ?? ""

          if (!firstName || !lastName || !company) {
            skipped.push(i + 1)
            continue
          }

          const domain = domainIdx >= 0 ? parts[domainIdx] : undefined
          const linkedinUrl = linkedinIdx >= 0 ? parts[linkedinIdx] : undefined

          parsed.push({
            firstName,
            lastName,
            company,
            ...(domain ? { domain } : {}),
            ...(linkedinUrl?.startsWith("http") ? { linkedinUrl } : {}),
            status: 'pending',
          })
        }

        setContacts(parsed)

        if (parsed.length === 0) {
          toast.error("No usable rows found. Each row needs a first name, last name and company.")
        } else if (skipped.length > 0) {
          toast.warning(`Loaded ${parsed.length} contacts. Skipped ${skipped.length} incomplete row${skipped.length === 1 ? "" : "s"}.`)
        } else {
          toast.success(`Loaded ${parsed.length} contacts from CSV`)
        }
      } catch (err) {
        toast.error("Failed to parse CSV file")
      }
    }
    reader.onerror = () => toast.error("Could not read that file")
    reader.readAsText(file)
  }

  const handleDiscover = async () => {
    if (contacts.length === 0) return

    setIsDiscovering(true)
    setProgress(0)
    setFinished(false)

    const working: ParsedContact[] = contacts.map((c) => ({ ...c, status: 'pending' }))
    setContacts([...working])

    try {
      for (let offset = 0; offset < working.length; offset += BATCH_SIZE) {
        const batch = working.slice(offset, offset + BATCH_SIZE)

        for (let j = 0; j < batch.length; j++) working[offset + j].status = 'processing'
        setContacts([...working])

        const res = await fetch("/api/contacts/bulk-discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            save: true,
            profiles: batch.map(({ firstName, lastName, company, domain, linkedinUrl }) => ({
              firstName, lastName, company,
              ...(domain ? { domain } : {}),
              ...(linkedinUrl ? { linkedinUrl } : {}),
            })),
          }),
        })

        if (!res.ok) throw new Error(await readError(res))

        const body = await res.json()
        const rows: any[] = body.data ?? []

        rows.forEach((row, j) => {
          const target = working[offset + j]
          if (!target) return
          if (row?.status === 'success') {
            target.status = 'success'
            target.emails = row.result?.contact?.emails ?? []
            target.savedId = row.savedId ?? null
          } else {
            target.status = 'error'
            target.error = row?.error ?? 'Discovery failed'
          }
        })

        setProgress(Math.round((Math.min(offset + BATCH_SIZE, working.length) / working.length) * 100))
        setContacts([...working])
      }

      setFinished(true)
      const found = working.filter((c) => c.status === 'success' && (c.emails?.length ?? 0) > 0).length
      toast.success(`Bulk discovery complete — addresses for ${found} of ${working.length} contacts`)
      onComplete?.()
    } catch (err) {
      // Whatever has not been answered stays visibly unfinished.
      for (const row of working) {
        if (row.status === 'processing') {
          row.status = 'error'
          row.error = err instanceof Error ? err.message : 'Bulk discovery failed'
        }
      }
      setContacts([...working])
      const message = err instanceof Error ? err.message : "Bulk discovery failed"
      toast.error(message === "Unauthorized" ? "Sign in to run bulk discovery" : message)
    } finally {
      setIsDiscovering(false)
    }
  }

  const exportResults = async () => {
    const ids = contacts.map((c) => c.savedId).filter((id): id is string => Boolean(id))
    if (ids.length === 0) {
      toast.error("Nothing was saved, so there is nothing to export")
      return
    }
    try {
      await downloadExport(ids, "csv")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    }
  }

  const clearData = () => {
    setFile(null)
    setContacts([])
    setProgress(0)
    setFinished(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const bestEmail = (c: ParsedContact): DiscoveredEmail | null => c.emails?.[0] ?? null

  return (
    <div className="space-y-6">
      {!file ? (
        <Card>
          <CardHeader>
            <CardTitle>Bulk Contact Discovery</CardTitle>
            <CardDescription>
              Upload a CSV with firstName, lastName and company to look up addresses in bulk.
              Optional domain and linkedinUrl columns are used when present.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-1">Click or drag CSV file here</h3>
              <p className="text-sm text-muted-foreground mb-4">Format: firstName, lastName, company</p>
              <Button variant="secondary" type="button">Browse Files</Button>
            </div>

            <div className="mt-6 bg-muted/50 p-4 rounded-md">
              <h4 className="text-sm font-medium mb-2">Example CSV Format:</h4>
              <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
                firstName,lastName,company{"\n"}
                Jane,Doe,Google{"\n"}
                John,Smith,Microsoft{"\n"}
                Alice,Johnson,Apple
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center">
                <FileText className="h-5 w-5 mr-2 text-primary" />
                {file.name}
              </CardTitle>
              <CardDescription>
                {contacts.length} {contacts.length === 1 ? "contact" : "contacts"} ready for discovery
                {contacts.length > BATCH_SIZE && ` · sent in batches of ${BATCH_SIZE}`}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={clearData} disabled={isDiscovering}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {isDiscovering && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Discovering contacts…
                  </span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <div className="border rounded-md max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Best Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((c, i) => {
                    const email = bestEmail(c)
                    return (
                      <TableRow key={i}>
                        <TableCell>{c.firstName}</TableCell>
                        <TableCell>{c.lastName}</TableCell>
                        <TableCell>{c.company}</TableCell>
                        <TableCell>
                          {c.status === 'pending' && <Badge variant="outline" className="text-muted-foreground">Pending</Badge>}
                          {c.status === 'processing' && <Badge variant="outline" className="text-blue-500 border-blue-200 bg-blue-50 dark:bg-blue-900/20">Processing</Badge>}
                          {c.status === 'success' && (
                            email
                              ? <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20"><Check className="h-3 w-3 mr-1" /> Found</Badge>
                              : <Badge variant="outline" className="text-muted-foreground">Nothing found</Badge>
                          )}
                          {c.status === 'error' && (
                            <Badge variant="outline" className="text-red-500 border-red-200 bg-red-50 dark:bg-red-900/20" title={c.error}>
                              <AlertTriangle className="h-3 w-3 mr-1" /> Failed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {email ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate">{email.address}</span>
                              {!isObserved(email) && (
                                <span title="Constructed from the company's naming pattern — not a published address">
                                  <Lightbulb className="h-3 w-3 text-sky-500 shrink-0" />
                                </span>
                              )}
                            </div>
                          ) : c.status === 'error' ? (
                            <span className="text-xs text-muted-foreground">{c.error}</span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {finished && contacts.some((c) => c.emails?.some((e) => !isObserved(e))) && (
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <Lightbulb className="h-3 w-3 mt-0.5 text-sky-500 shrink-0" />
                Rows marked with this icon are addresses inferred from the employer's naming
                pattern. They are plausible, not confirmed.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={clearData} disabled={isDiscovering}>
              Cancel
            </Button>

            {finished ? (
              <Button onClick={exportResults}>
                <Download className="h-4 w-4 mr-2" />
                Export Results
              </Button>
            ) : (
              <Button onClick={handleDiscover} disabled={isDiscovering || contacts.length === 0}>
                {isDiscovering ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> Discover All</>
                )}
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
