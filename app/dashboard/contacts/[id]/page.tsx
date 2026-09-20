"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Building2, Briefcase, Mail, Phone, Copy, Check, ExternalLink, ShieldCheck, Plus, AlertTriangle, Lightbulb, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { ExportDialog } from "@/components/contacts/export-dialog"
import { ContactView, fromRevealRow, sourceLabel, isObserved } from "@/lib/contacts/normalize"
import { readError } from "@/lib/contacts/client"

interface ListMembership {
  list_id: string;
  contact_lists?: { id: string; name: string } | null;
}

export default function ContactDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [contact, setContact] = useState<ContactView | null>(null)
  const [memberships, setMemberships] = useState<ListMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/reveal/${id}`)
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json()
      setContact(fromRevealRow(body.data))
      setMemberships(body.lists ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contact")
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

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

  const copyAllEmails = () => {
    if (!contact) return
    copyToClipboard(contact.emails.map((e) => e.address).join(", "))
  }

  const loadLists = async () => {
    if (lists) return
    try {
      const res = await fetch("/api/contacts/lists")
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json()
      setLists((body.data ?? []).map((l: any) => ({ id: l.id, name: l.name })))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your lists")
      setLists([])
    }
  }

  const addToList = async (listId: string, listName: string) => {
    try {
      const res = await fetch(`/api/contacts/lists/${listId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealId: id }),
      })
      if (!res.ok) throw new Error(await readError(res))
      toast.success(`Added to ${listName}`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to list")
    }
  }

  const deleteContact = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/reveal/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await readError(res))
      toast.success("Contact deleted")
      router.push("/dashboard/contacts")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this contact")
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl flex justify-center items-center h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contact profile…
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Button variant="ghost" onClick={() => router.push("/dashboard/contacts")} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Contacts
        </Button>
        <div className="text-center py-20 border rounded-lg bg-muted/20">
          <AlertTriangle className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Contact not available</h3>
          <p className="text-muted-foreground mt-2">
            {error === "Unauthorized"
              ? "Sign in to view your saved contacts."
              : error ?? "The contact you're looking for doesn't exist or was deleted."}
          </p>
        </div>
      </div>
    )
  }

  const inferredOnly = contact.emails.length > 0 && contact.emails.every((e) => !isObserved(e))

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <Button variant="ghost" onClick={() => router.push("/dashboard/contacts")} className="-ml-4 mb-2">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Contacts
      </Button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="flex items-start gap-6">
          <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-3xl border-4 border-background shadow-sm uppercase">
            {contact.firstName[0]}{contact.lastName[0]}
          </div>
          <div className="space-y-2 pt-2">
            <h1 className="text-3xl font-bold tracking-tight">{contact.firstName} {contact.lastName}</h1>
            <div className="flex items-center text-lg text-muted-foreground">
              <Briefcase className="mr-2 h-5 w-5" />
              {contact.title || "Role not recorded"} at {contact.company}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {contact.socials.linkedin && (
                <a href={contact.socials.linkedin} target="_blank" rel="noopener noreferrer">
                  <Badge variant="secondary" className="hover:bg-primary/20 cursor-pointer">LinkedIn <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                </a>
              )}
              {contact.socials.github && (
                <a href={contact.socials.github} target="_blank" rel="noopener noreferrer">
                  <Badge variant="secondary" className="hover:bg-primary/20 cursor-pointer">GitHub <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                </a>
              )}
              {contact.socials.twitter && (
                <a href={contact.socials.twitter} target="_blank" rel="noopener noreferrer">
                  <Badge variant="secondary" className="hover:bg-primary/20 cursor-pointer">X / Twitter <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <DropdownMenu onOpenChange={(open) => { if (open) loadLists() }}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add to List
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Your lists</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {lists === null && <DropdownMenuItem disabled><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…</DropdownMenuItem>}
              {lists?.length === 0 && <DropdownMenuItem disabled>No lists yet</DropdownMenuItem>}
              {lists?.map((list) => (
                <DropdownMenuItem key={list.id} onSelect={() => addToList(list.id, list.name)}>
                  {list.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ExportDialog contactIds={[id]} />
          <Button variant="ghost" size="icon" onClick={deleteContact} disabled={deleting} title="Delete contact">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Discovered Emails</CardTitle>
                <CardDescription>
                  Addresses found published for this person, plus any the company's naming pattern implies.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={copyAllEmails} disabled={contact.emails.length === 0}>
                <Copy className="mr-2 h-4 w-4" />
                Copy All
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {contact.emails.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No addresses were found for this person, and no pattern could be inferred for {contact.domain || "their domain"}.
                </p>
              )}

              {inferredOnly && (
                <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900/50 dark:bg-sky-900/20">
                  <Lightbulb className="h-4 w-4 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  <p className="text-sky-900 dark:text-sky-200">
                    Every address below was constructed from {contact.company}'s observed naming
                    pattern. None of them was published anywhere, and none has been confirmed to
                    receive mail.
                  </p>
                </div>
              )}

              {contact.emails.map((email, idx) => {
                const observed = isObserved(email)
                return (
                  <div key={`${email.address}-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg bg-card gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{email.address}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {!observed ? (
                            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400">
                              <Lightbulb className="mr-1 h-3 w-3" /> Inferred, not confirmed
                            </Badge>
                          ) : email.verified ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
                              <ShieldCheck className="mr-1 h-3 w-3" /> Domain accepts mail
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
                              <AlertTriangle className="mr-1 h-3 w-3" /> Unverified
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{sourceLabel(email.source)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <div className="text-right mr-2">
                        <div className="text-sm font-medium">{email.confidence}%</div>
                        <div className="text-xs text-muted-foreground">Confidence</div>
                      </div>
                      <Button variant="secondary" size="icon" onClick={() => copyToClipboard(email.address)}>
                        {copiedEmail === email.address ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {contact.phones.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Phone className="h-4 w-4" /> Phone</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.phones.map((phone, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{phone.number}</span>
                    <span className="text-xs text-muted-foreground">{phone.type} · {phone.source}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Company</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{contact.company}</div>
                  {contact.domain && (
                    <a href={`https://${contact.domain}`} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-primary hover:underline flex items-center">
                      {contact.domain} <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Firmographics are only shown where the app actually holds them —
                  the company registry page. Nothing is asserted here. */}
              <div className="pt-4 border-t text-sm">
                <Link href={`/companies?q=${encodeURIComponent(contact.company)}`}
                      className="text-primary hover:underline inline-flex items-center">
                  View company profile <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {memberships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>In your lists</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {memberships.map((m) => (
                  <Badge key={m.list_id} variant="secondary">
                    {m.contact_lists?.name ?? "Unnamed list"}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {contact.revealedAt && (
            <p className="text-xs text-muted-foreground">
              Revealed {new Date(contact.revealedAt).toLocaleString("en-GB")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
