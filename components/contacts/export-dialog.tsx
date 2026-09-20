"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toast } from "sonner"
import { ContactView } from "@/lib/contacts/normalize"
import { downloadExport, ExportFormat } from "@/lib/contacts/client"

interface ExportDialogProps {
  /** Everything currently on screen — the "all" scope exports these. */
  contacts?: ContactView[];
  /** A specific selection, e.g. the single contact on a detail page. */
  contactIds?: string[];
  trigger?: React.ReactNode;
}

export function ExportDialog({ contacts = [], contactIds = [], trigger }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv")
  const [scope, setScope] = useState(contactIds.length > 0 ? "selected" : "all")
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Only saved contacts have an id, and only saved contacts can be exported —
  // the export route reads rows back out of the database by id.
  const allIds = contacts.map((c) => c.id).filter((id): id is string => Boolean(id))
  const selectedIds = scope === "selected" ? contactIds : allIds

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await downloadExport(selectedIds, format)
      toast.success(`Downloaded ${selectedIds.length} contact${selectedIds.length === 1 ? "" : "s"} as ${format.toUpperCase()}`)
      setIsOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export contacts")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Contacts</DialogTitle>
          <DialogDescription>
            Download your saved contacts in your preferred format.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-3">
            <Label>Export Scope</Label>
            <RadioGroup value={scope} onValueChange={setScope} className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="scope-all" disabled={allIds.length === 0} />
                <Label htmlFor="scope-all" className="font-normal">
                  All saved contacts ({allIds.length})
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="selected" id="scope-selected" disabled={contactIds.length === 0} />
                <Label htmlFor="scope-selected" className="font-normal">
                  Selected contacts ({contactIds.length})
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <Label>File Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="format-csv" />
                <Label htmlFor="format-csv" className="font-normal">CSV (Excel, Google Sheets)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="json" id="format-json" />
                <Label htmlFor="format-json" className="font-normal">JSON (For developers)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="vcard" id="format-vcard" />
                <Label htmlFor="format-vcard" className="font-normal">vCard (Contacts app)</Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || selectedIds.length === 0}>
            {isExporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting…</> : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
