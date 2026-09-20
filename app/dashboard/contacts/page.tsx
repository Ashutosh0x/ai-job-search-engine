"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, List, Upload, Users, ShieldCheck, Database, AlertTriangle, Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ContactSearch } from "@/components/contacts/contact-search"
import { ContactCard } from "@/components/contacts/contact-card"
import { ContactListManager } from "@/components/contacts/contact-list-manager"
import { BulkUpload } from "@/components/contacts/bulk-upload"
import { ExportDialog } from "@/components/contacts/export-dialog"
import { ContactView } from "@/lib/contacts/normalize"
import { fetchReveals, RevealStats } from "@/lib/contacts/client"

export default function ContactsDashboardPage() {
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [stats, setStats] = useState<RevealStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState("search")

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { contacts, stats } = await fetchReveals()
      setContacts(contacts)
      setStats(stats)
    } catch (err) {
      // No stand-in numbers: if the read failed, the page says so and shows nothing.
      setError(err instanceof Error ? err.message : "Could not load your contacts")
      setContacts([])
      setStats(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (requested) setTab(requested)
  }, [])

  const verifiedRate = stats && stats.totalReveals > 0
    ? Math.round((stats.verifiedReveals / stats.totalReveals) * 100)
    : null

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contact Discovery</h1>
          <p className="text-muted-foreground mt-1">
            Find recruiter emails and contacts for any company.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDialog contacts={contacts} />
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Could not load your contacts</p>
              <p className="text-muted-foreground mt-1">
                {error === "Unauthorized" ? "Sign in to see contacts you have revealed." : error}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats — all three are counted from this user's own rows. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Reveals"
          icon={<Database className="h-4 w-4 text-muted-foreground" />}
          value={stats ? String(stats.totalReveals) : null}
          caption="Contacts you have saved"
          loading={isLoading}
        />
        <StatCard
          title="With a live mail domain"
          icon={<ShieldCheck className="h-4 w-4 text-green-500" />}
          value={stats ? String(stats.verifiedReveals) : null}
          caption={verifiedRate === null ? "No reveals yet" : `${verifiedRate}% of your reveals`}
          loading={isLoading}
        />
        <StatCard
          title="Lists Created"
          icon={<List className="h-4 w-4 text-muted-foreground" />}
          value={stats ? String(stats.listCount) : null}
          caption="Lead lists you own"
          loading={isLoading}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full md:w-[600px] grid-cols-4 mb-8">
          <TabsTrigger value="search">
            <Search className="h-4 w-4 mr-2 hidden sm:block" />
            Search
          </TabsTrigger>
          <TabsTrigger value="contacts">
            <Users className="h-4 w-4 mr-2 hidden sm:block" />
            My Contacts
          </TabsTrigger>
          <TabsTrigger value="lists">
            <List className="h-4 w-4 mr-2 hidden sm:block" />
            Lists
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4 mr-2 hidden sm:block" />
            Bulk Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-0">
          <div className="max-w-3xl">
            <ContactSearch onRevealed={load} />
          </div>
        </TabsContent>

        <TabsContent value="contacts" className="mt-0">
          {isLoading ? (
            <div className="flex justify-center items-center gap-2 py-20 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
            </div>
          ) : contacts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {contacts.map((contact) => (
                <ContactCard key={contact.id} contact={contact} onChanged={load} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 border rounded-lg bg-muted/20">
              <Users className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No contacts yet</h3>
              <p className="text-muted-foreground max-w-sm mx-auto mt-2">
                Use the search tab to find and reveal contact information for recruiters and hiring managers.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="lists" className="mt-0">
          <ContactListManager />
        </TabsContent>

        <TabsContent value="upload" className="mt-0">
          <div className="max-w-4xl">
            <BulkUpload onComplete={load} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ title, icon, value, caption, loading }: {
  title: string;
  icon: React.ReactNode;
  value: string | null;
  caption: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : value ?? "—"}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {loading ? "Loading…" : value === null ? "Unavailable" : caption}
        </p>
      </CardContent>
    </Card>
  )
}
