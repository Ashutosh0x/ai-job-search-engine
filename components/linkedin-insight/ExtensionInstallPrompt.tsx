'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Chrome, Copy, Check, ExternalLink, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ExtensionInstallPromptProps {
  /** A Web Store listing, when one exists. Null means sideload is the only route. */
  installUrl?: string | null
  onRetry?: () => void
}

const STEPS = [
  { title: 'Open the extensions page', detail: 'Paste chrome://extensions into a new tab.', copy: 'chrome://extensions' },
  { title: 'Turn on Developer mode', detail: 'The toggle sits in the top-right corner of that page.' },
  { title: 'Load unpacked', detail: 'Click "Load unpacked" and pick the chrome-extension folder from this repository.' },
  { title: 'Open a LinkedIn profile', detail: 'Visit any profile in another tab. This page picks it up automatically.' },
]

export function ExtensionInstallPrompt({ installUrl, onRetry }: ExtensionInstallPromptProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard access can be denied; the text is on screen either way.
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Chrome className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle>Connect the browser extension</CardTitle>
              <CardDescription>
                LinkedIn and this app are different origins, so the page cannot read a LinkedIn
                tab on its own. The extension is the bridge between them.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {installUrl ? (
            <Button asChild>
              <a href={installUrl} target="_blank" rel="noopener noreferrer">
                Install from the Chrome Web Store <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Not published to the Chrome Web Store yet</p>
              <p className="text-muted-foreground mt-1">
                Load it from disk with the four steps below. This takes about a minute.
              </p>
            </div>
          )}

          <ol className="space-y-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                  {step.copy && (
                    <button
                      type="button"
                      onClick={() => copy(step.copy!)}
                      className="mt-2 inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 font-mono text-xs hover:bg-muted transition-colors"
                    >
                      {step.copy}
                      {copied === step.copy
                        ? <Check className="h-3 w-3 text-green-600" />
                        : <Copy className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
            <ShieldCheck className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-amber-900 dark:text-amber-200">
              The extension reads only the profile page you are looking at, and only while you are
              looking at it. It does not browse LinkedIn for you or collect anything in the
              background. Automated collection is against LinkedIn's terms of service — keep this
              to profiles you open yourself.
            </p>
          </div>

          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              I've installed it — check again
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
