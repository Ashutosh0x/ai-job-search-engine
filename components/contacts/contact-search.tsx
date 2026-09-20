"use client"

import { useState } from "react"
import { Search, AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { ContactCard } from "./contact-card"
import { ContactView } from "@/lib/contacts/normalize"
import { discoverContact, revealContact } from "@/lib/contacts/client"

interface ContactSearchProps {
  /** Called with the saved contact after a successful reveal. */
  onRevealed?: (contact: ContactView) => void;
  /** Prefills the company fields when the form is embedded on a company page. */
  defaultCompany?: string;
  defaultDomain?: string;
}

export function ContactSearch({ onRevealed, defaultCompany = "", defaultDomain = "" }: ContactSearchProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ContactView | null>(null)

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    company: defaultCompany,
    domain: defaultDomain,
    linkedinUrl: "",
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  /** Empty optional fields must be omitted — the API validates `linkedinUrl` as a URL. */
  const buildRequest = () => ({
    firstName: formData.firstName.trim(),
    lastName: formData.lastName.trim(),
    company: formData.company.trim(),
    ...(formData.domain.trim() ? { domain: formData.domain.trim() } : {}),
    ...(formData.linkedinUrl.trim() ? { linkedinUrl: formData.linkedinUrl.trim() } : {}),
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // Discovery only. Nothing is written until the user chooses to save, and
      // a failure here is surfaced as a failure — there is no stand-in result.
      setResult(await discoverContact(buildRequest()))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Discovery failed"
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const saved = await revealContact(buildRequest())
      setResult(saved)
      toast.success("Saved to your contacts")
      onRevealed?.(saved)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save this contact"
      toast.error(message === "Unauthorized" ? "Sign in to save contacts" : message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Find Contact Information</CardTitle>
          <CardDescription>
            Enter a person's details to look for published addresses and to infer the
            address their employer's naming pattern would produce.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input id="firstName" name="firstName" value={formData.firstName}
                       onChange={handleChange} placeholder="e.g. Jane" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input id="lastName" name="lastName" value={formData.lastName}
                       onChange={handleChange} placeholder="e.g. Smith" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company *</Label>
                <Input id="company" name="company" value={formData.company}
                       onChange={handleChange} placeholder="e.g. Google" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="domain">Company Domain (Optional)</Label>
                <Input id="domain" name="domain" value={formData.domain}
                       onChange={handleChange} placeholder="e.g. google.com" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="linkedinUrl">LinkedIn URL (Optional)</Label>
                <Input id="linkedinUrl" name="linkedinUrl" type="url" value={formData.linkedinUrl}
                       onChange={handleChange} placeholder="https://linkedin.com/in/janesmith" />
              </div>
            </div>

            <Button type="submit" className="w-full md:w-auto mt-4" disabled={loading}>
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching…</>
              ) : (
                <><Search className="mr-2 h-4 w-4" /> Discover Contact</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Discovery failed</p>
              <p className="text-muted-foreground mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-medium">Discovery Results</h3>
            {!result.saved && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save to my contacts
              </Button>
            )}
          </div>
          <ContactCard contact={result} />
        </div>
      )}
    </div>
  )
}
