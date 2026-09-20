'use client'

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Mail, Copy, Check, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useState } from 'react'

interface EmailData {
  address: string
  confidence: number
  source: string
  verified: boolean
}

interface ContactDiscoveryCardProps {
  emails: EmailData[] | null
  loading: boolean
  onDiscover: () => void
}

export function ContactDiscoveryCard({ emails, loading, onDiscover }: ContactDiscoveryCardProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (email: string) => {
    navigator.clipboard.writeText(email)
    setCopied(email)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-slate-500" />
          Contact Discovery
        </CardTitle>
        <CardDescription>Find verified email addresses for this profile</CardDescription>
      </CardHeader>
      <CardContent>
        {!emails && !loading && (
          <div className="text-center py-6">
            <Button onClick={onDiscover} className="w-full">
              Discover Contacts
            </Button>
          </div>
        )}

        {loading && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
            <div className="flex items-center justify-center text-sm text-slate-500 mt-4 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching databases...
            </div>
          </div>
        )}

        {emails && (
          <div className="space-y-4">
            {emails.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No contact information found.</p>
            ) : (
              emails.map((email, idx) => (
                <div key={idx} className="flex flex-col gap-2 p-3 border border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      {email.address}
                      {email.verified ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(email.address)}>
                      {copied === email.address ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Progress value={email.confidence} className="h-1.5 flex-1" />
                    <span className="text-xs text-slate-500 w-8">{email.confidence}%</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Source: {email.source}</span>
                    {email.verified ? (
                      <Badge variant="outline" className="text-[10px] h-4 py-0 border-emerald-200 text-emerald-600 dark:border-emerald-900 dark:text-emerald-400">Verified</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-4 py-0 border-amber-200 text-amber-600 dark:border-amber-900 dark:text-amber-400">Unverified</Badge>
                    )}
                  </div>
                </div>
              ))
            )}
            <Button variant="outline" className="w-full text-xs" onClick={onDiscover}>
              Refresh Search
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
