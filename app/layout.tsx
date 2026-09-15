import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ClientRootLayout } from "@/components/client-root-layout"
import { SITE_NAME, SITE_URL } from "@/lib/site"

// `Fira_Code` was imported and instantiated here but never applied to anything.
// next/font downloads, subsets and self-hosts a face at build time on the
// strength of the call alone, so this shipped a second font family that no
// element ever used.
const inter = Inter({ subsets: ["latin"], display: "swap" })

export const metadata: Metadata = {
  /**
   * `metadataBase` is what makes every relative `alternates.canonical` and
   * every Open Graph image on every page resolve to an absolute URL. Without
   * it Next emits a build warning and falls back to localhost, so each page's
   * canonical quietly pointed a crawler at a host it cannot reach.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    // Pages set their own title; this frames it. A job page becomes
    // "Senior Backend Engineer at Stripe — London · AI Job Search".
    default: "AI Job Search — search 113,000 jobs from employers' own boards",
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Search jobs read directly from employers' own applicant tracking systems. " +
    "Every listing links to the company's own application page — no reposts, no intermediaries.",
  applicationName: SITE_NAME,
  // Was `generator: "v0.dev"`, a scaffolding artefact that told every crawler
  // and every "what is this site built with" tool the wrong thing.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: "AI Job Search — jobs from employers' own boards",
    description:
      "Search jobs read directly from employers' applicant tracking systems, with filters no major job board offers.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Job Search — jobs from employers' own boards",
    description:
      "Search jobs read directly from employers' applicant tracking systems.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  alternates: { canonical: "/" },
  formatDetection: { telephone: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    /**
     * `suppressHydrationWarning` is required by next-themes and is the reason
     * ClientRootLayout no longer has to blank the server render: next-themes
     * writes the theme class onto <html> before paint, so this attribute
     * legitimately differs between server and client. The flag scopes that
     * exemption to this one element rather than to the whole application.
     */
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        {/*
          Keyboard users land on the navigation on every page and have to tab
          through the whole of it to reach the results. The link is visually
          hidden until it takes focus, which is the point -- it is the first
          thing Tab reaches and the first thing a screen reader announces.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-purple-600 dark:focus:bg-gray-900 dark:focus:text-gray-100"
        >
          Skip to main content
        </a>
        <ClientRootLayout>
          <div id="main-content">{children}</div>
        </ClientRootLayout>
      </body>
    </html>
  )
}
