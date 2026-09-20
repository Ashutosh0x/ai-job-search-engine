"use client"

import { useState, useEffect, useCallback } from "react"
import { Trash2, Plus, Users, FolderOpen, Loader2, AlertTriangle, ChevronRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from "sonner"
import { readError } from "@/lib/contacts/client"
import { ContactView, fromRevealRow } from "@/lib/contacts/normalize"
import { ContactCard } from "./contact-card"

interface ContactListRow {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  created_at: string;
}

export function ContactListManager() {
  const [lists, setLists] = useState<ContactListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newList, setNewList] = useState({ name: "", description: "" })

  const [openListId, setOpenListId] = useState<string | null>(null)
  const [openListContacts, setOpenListContacts] = useState<ContactView[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/contacts/lists")
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json()
      setLists(body.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your lists")
      setLists([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreateList = async () => {
    if (!newList.name.trim()) {
      toast.error("List name is required")
      return
    }
    setCreating(true)
    try {
      const res = await fetch("/api/contacts/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newList.name.trim(),
          ...(newList.description.trim() ? { description: newList.description.trim() } : {}),
        }),
      })
      if (!res.ok) throw new Error(await readError(res))
      setNewList({ name: "", description: "" })
      setIsCreateOpen(false)
      toast.success("List created")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the list")
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteList = async (id: string, name: string) => {
    try {
      const res = await fetch("/api/contacts/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: id }),
      })
      if (!res.ok) throw new Error(await readError(res))
      toast.success(`Deleted ${name}`)
      if (openListId === id) {
        setOpenListId(null)
        setOpenListContacts(null)
      }
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the list")
    }
  }

  const openList = async (id: string) => {
    if (openListId === id) {
      setOpenListId(null)
      setOpenListContacts(null)
      return
    }
    setOpenListId(id)
    setOpenListContacts(null)
    try {
      const res = await fetch(`/api/contacts/lists/${id}/items`)
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json()
      setOpenListContacts(
        (body.data ?? [])
          .map((item: any) => item.contact_reveals)
          .filter(Boolean)
          .map(fromRevealRow)
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the list")
      setOpenListContacts([])
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Contact Lists</h2>
          <p className="text-muted-foreground">Manage your saved contacts and leads.</p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create List
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Contact List</DialogTitle>
              <DialogDescription>
                Create a new list to organize your discovered contacts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">List Name</Label>
                <Input
                  id="name"
                  value={newList.name}
                  onChange={(e) => setNewList({ ...newList, name: e.target.value })}
                  placeholder="e.g. Q3 Hiring Managers"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  value={newList.description}
                  onChange={(e) => setNewList({ ...newList, description: e.target.value })}
                  placeholder="Brief description of this list"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>Cancel</Button>
              <Button onClick={handleCreateList} disabled={creating}>
                {creating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Could not load your lists</p>
              <p className="text-muted-foreground mt-1">
                {error === "Unauthorized" ? "Sign in to manage contact lists." : error}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lists…
        </div>
      ) : lists.length === 0 && !error ? (
        <div className="text-center py-20 border rounded-lg bg-muted/20">
          <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No lists yet</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2">
            Create a list to group the contacts you reveal.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lists.map((list) => (
            <Card
              key={list.id}
              className={`cursor-pointer transition-colors ${openListId === list.id ? "border-primary" : "hover:border-primary/50"}`}
              onClick={() => openList(list.id)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex justify-between items-start gap-2">
                  <span className="flex items-center min-w-0">
                    <FolderOpen className="h-5 w-5 mr-2 text-primary shrink-0" />
                    <span className="truncate">{list.name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteList(list.id, list.name)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>{list.description || "No description"}</CardDescription>
              </CardHeader>
              <CardFooter className="pt-3 border-t text-sm text-muted-foreground flex justify-between">
                <span className="flex items-center">
                  <Users className="h-4 w-4 mr-1" />
                  {list.item_count} {list.item_count === 1 ? "contact" : "contacts"}
                </span>
                <span>
                  Created {new Date(list.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {openListId && (
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            {lists.find((l) => l.id === openListId)?.name ?? "List"}
          </h3>
          {openListContacts === null ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
            </div>
          ) : openListContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              This list is empty. Add contacts from the My Contacts tab.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {openListContacts.map((contact) => (
                <ContactCard key={contact.id} contact={contact} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
