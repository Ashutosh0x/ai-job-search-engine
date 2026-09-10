import type React from "react"
import type { Metadata } from "next"
import { Inter, Fira_Code } from "next/font/google"
import "./globals.css"
import { ClientRootLayout } from "@/components/client-root-layout"

const inter = Inter({ subsets: ["latin"] })
const firaCode = Fira_Code({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "AI Job Search - Find Your Dream Job",
  description: "AI-powered job search platform with resume optimization and smart matching",
  generator: "v0.dev",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <ClientRootLayout>{children}</ClientRootLayout>
      </body>
    </html>
  )
}
