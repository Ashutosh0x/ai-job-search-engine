"use client"

import { useState, useEffect } from "react"
import { Mail, Phone, Building2, Copy, Check, ExternalLink, Plus, Download, Github, Linkedin, HelpCircle, Loader2, Lightbulb } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { ContactView, sourceLabel, isObserved } from "@/lib/contacts/normalize"
import { downloadExport, ExportFormat } from "@/lib/contacts/client"

interface ContactCardProps {
  contact: ContactView;
  /** Shown after the card mutates something the parent is also rendering. */
  onChanged?: () => void;
}

interface ListOption {
  id: string;
  name: string;
}

export function ContactCard({ contact, onChanged }: ContactCardProps) {
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [lists, setLists] = useState<ListOption[] | null>(null)
  const [listsLoading, setListsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedEmail(text)
      toast.success("Copied to clipboard")
      setTimeout(() => setCopiedEmail(null), 2000)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  const loadLists = async () => {
    if (lists || listsLoading) return
    setListsLoading(true)
    try {
      const res = await fetch("/api/contacts/lists")
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json()
      setLists((body.data ?? []).map((l: any) => ({ id: l.id, name: l.name })))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your lists")
      setLists([])
    } finally {
      setListsLoading(false)
    }
  }

  const addToList = async (listId: string, listName: string) => {
    if (!contact.id) {
      toast.error("Save this contact before adding it to a list")
      return
    }
    try {
      const res = await fetch(`/api/contacts/lists/${listId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealId: contact.id }),
      })
      if (!res.ok) throw new Error(await readError(res))
      toast.success(`Added to ${listName}`)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to list")
    }
  }

  const exportContact = async (format: ExportFormat) => {
    if (!contact.id) {
      toast.error("Save this contact before exporting it")
      return
    }
    setExporting(true)
    try {
      await downloadExport([contact.id], format)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    if (confidence >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
  }

  const initials = `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}` || "?"
  const inferredCount = contact.emails.filter((e) => !isObserved(e)).length

  return (
    <Card className="w-full overflow-hidden transition-all hover:shadow-md">
      <CardHeader className="bg-muted/40 pb-4">
        <div className="flex justify-between items-start gap-3">
          <div className="flex gap-4 items-center min-w-0">
            <div className="h-12 w-12 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg uppercase">
              {initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold truncate">
                {contact.id ? (
                  <Link href={`/dashboard/contacts/${contact.id}`} className="hover:underline">
                    {contact.firstName} {contact.lastName}
                  </Link>
                ) : (
                  <>{contact.firstName} {contact.lastName}</>
                )}
              </h3>
              {contact.title && <p className="text-sm text-muted-foreground truncate">{contact.title}</p>}
              <div className="flex items-center text-sm text-muted-foreground mt-1 truncate">
                <Building2 className="h-3 w-3 mr-1 shrink-0" />
                {contact.company}
                {contact.domain && <span className="ml-1 text-xs">({contact.domain})</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <DropdownMenu onOpenChange={(open) => { if (open) loadLists() }}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!contact.id}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add to List
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Your lists</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {listsLoading && (
                  <DropdownMenuItem disabled>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
                  </DropdownMenuItem>
                )}
                {!listsLoading && lists?.length === 0 && (
                  <DropdownMenuItem disabled>No lists yet</DropdownMenuItem>
                )}
                {lists?.map((list) => (
                  <DropdownMenuItem key={list.id} onSelect={() => addToList(list.id, list.name)}>
                    {list.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/contacts?tab=lists">Manage lists…</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={!contact.id || exporting}>
                  {exporting
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Download className="h-4 w-4 mr-2" />}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportContact("csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportContact("json")}>JSON</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportContact("vcard")}>vCard</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center">
              <Mail className="h-4 w-4 mr-2" />
              Discovered Emails
            </h4>

            {contact.emails.length > 0 ? (
              <div className="space-y-3">
                {contact.emails.map((email, i) => {
                  const observed = isObserved(email)
                  return (
                    <div key={`${email.address}-${i}`} className="flex items-center justify-between gap-2 p-3 border rounded-md bg-card">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <div className="font-medium text-sm truncate">{email.address}</div>

                        <Badge variant="outline" className={`text-xs ${getConfidenceColor(email.confidence)}`}>
                          {email.confidence}% confidence
                        </Badge>

                        <Badge variant="secondary" className="text-xs text-muted-foreground" title={sourceLabel(email.source)}>
                          {email.source}
                        </Badge>

                        {observed ? (
                          email.verified ? (
                            <span className="flex items-center text-xs text-green-600 dark:text-green-400" title="Published address on a domain that accepts mail">
                              <Check className="h-3 w-3 mr-1" /> Domain accepts mail
                            </span>
                          ) : (
                            <span className="flex items-center text-xs text-amber-600 dark:text-amber-400" title="Found publicly, but the domain did not answer an MX lookup">
                              <HelpCircle className="h-3 w-3 mr-1" /> Unverified
                            </span>
                          )
                        ) : (
                          <span className="flex items-center text-xs text-sky-600 dark:text-sky-400" title="Constructed from this company's observed naming pattern. Nobody has published this address.">
                            <Lightbulb className="h-3 w-3 mr-1" /> Inferred, not confirmed
                          </span>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => copyToClipboard(email.address)}
                      >
                        {copiedEmail === email.address ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        <span className="sr-only">Copy email</span>
                      </Button>
                    </div>
                  )
                })}

                {inferredCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {inferredCount === contact.emails.length
                      ? "Every address here was constructed from this company's naming pattern — none was published anywhere."
                      : `${inferredCount} of these ${contact.emails.length} addresses was constructed from the company's naming pattern rather than found published.`}
                    {" "}A pattern match means the address is plausible, not that the mailbox exists.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No addresses found. Nothing public matched this person, and no email pattern could be
                inferred for {contact.domain || "this domain"}.
              </p>
            )}
          </div>

          {contact.phones.length > 0 && (
            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium mb-3 flex items-center">
                <Phone className="h-4 w-4 mr-2" /> Phone
              </h4>
              <div className="space-y-2">
                {contact.phones.map((phone, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{phone.number}</span>
                    <Badge variant="secondary" className="text-xs">{phone.type}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(contact.socials.linkedin || contact.socials.github || contact.socials.twitter) && (
            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium mb-3">Public Profiles</h4>
              <div className="flex gap-2">
                {contact.socials.linkedin && (
                  <a href={contact.socials.linkedin} target="_blank" rel="noopener noreferrer"
                     title="LinkedIn profile"
                     className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-[#0a66c2]/10 text-[#0a66c2] hover:bg-[#0a66c2]/20 transition-colors">
                    <Linkedin className="h-4 w-4" />
                  </a>
                )}
                {contact.socials.github && (
                  <a href={contact.socials.github} target="_blank" rel="noopener noreferrer"
                     title="GitHub profile"
                     className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                    <Github className="h-4 w-4" />
                  </a>
                )}
                {contact.socials.twitter && (
                  <a href={contact.socials.twitter} target="_blank" rel="noopener noreferrer"
                     title="X / Twitter profile"
                     className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-muted hover:bg-muted/70 transition-colors">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          )}

          {contact.revealedAt && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Revealed {new Date(contact.revealedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body.error ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}
