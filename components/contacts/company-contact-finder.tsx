"use client"

import { useState } from "react"
import { Search, Lightbulb, Mail, ShieldCheck, ChevronDown } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContactSearch } from "./contact-search"

interface CompanyContactFinderProps {
  companyName: string;
  domain: string | null;
  /** The aggregate naming pattern the recruiting-intelligence build observed. */
  emailPatterns?: { pattern: string; share: number }[];
  /** Addresses the company published itself, carried through with evidence. */
  publishedContacts?: { address: string; kind: string; evidence: string }[];
}

/**
 * The "Find Contacts" surface on a company page.
 *
 * It keeps two kinds of fact visibly apart: what this company has published
 * (left as-is, with evidence) and what its naming pattern would imply for a
 * given person (clearly marked as inference). Blending them is what turns a
 * job-search tool into a spearphishing tool.
 */
export function CompanyContactFinder({
  companyName,
  domain,
  emailPatterns = [],
  publishedContacts = [],
}: CompanyContactFinderProps) {
  const [open, setOpen] = useState(false)
  const topPattern = emailPatterns.length
    ? [...emailPatterns].sort((a, b) => b.share - a.share)[0]
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Find Contacts
            </CardTitle>
            <CardDescription>
              Published addresses for {companyName}, and what its address pattern implies for
              someone you name.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Open"}
            <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" /> Published addresses
            </h4>
            {publishedContacts.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {publishedContacts.map((contact) => (
                  <li key={contact.address} className="text-sm">
                    <span className="font-medium">{contact.address}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{contact.kind}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{contact.evidence}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {companyName} publishes no recruiting address — applications go through its
                applicant tracking system.
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Observed address pattern
            </h4>
            {topPattern && domain ? (
              <div className="mt-3 space-y-2">
                <code className="text-sm font-medium">{topPattern.pattern}@{domain}</code>
                <Badge variant="secondary" className="ml-2 text-xs">
                  {Math.round(topPattern.share * 100)}% of observed addresses
                </Badge>
                <p className="text-xs text-muted-foreground">
                  A pattern describes how this company forms addresses. It is not evidence that
                  any particular mailbox exists.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No address pattern has been observed for {domain ?? "this company"} yet.
              </p>
            )}
          </div>
        </div>

        {open && (
          <div className="pt-2 border-t">
            <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm mb-6 dark:border-sky-900/50 dark:bg-sky-900/20">
              <Lightbulb className="h-4 w-4 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <p className="text-sky-900 dark:text-sky-200">
                Results combine addresses found published online with addresses constructed from
                the pattern above. Each one is labelled with which it is.
              </p>
            </div>
            <ContactSearch defaultCompany={companyName} defaultDomain={domain ?? ""} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
