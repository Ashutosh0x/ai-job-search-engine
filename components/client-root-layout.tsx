"use client";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast-provider";
import React from "react";

/**
 * Client-side providers wrapping every page.
 *
 * THIS USED TO DISABLE SERVER RENDERING FOR THE ENTIRE SITE
 * ---------------------------------------------------------
 * It held a `mounted` flag and returned null until an effect set it:
 *
 *   const [mounted, setMounted] = useState(false);
 *   useEffect(() => setMounted(true), []);
 *   if (!mounted) return null;
 *
 * Effects do not run on the server. This component wraps `children` in the root
 * layout, so every route rendered to `null` on the server and the HTML for the
 * whole application was an empty <body> holding nothing but script tags.
 *
 * MEASURED, 2026-09-15, against `next start`: `/`, `/companies`, `/jobs`,
 * `/explore-jobs` and a job detail page each returned zero <h1> elements and
 * zero content elements. Every one of them.
 *
 * What that cost:
 *
 *   - Crawlers that do not execute JavaScript -- Bing, and every social and
 *     chat unfurler -- saw a blank page on all 113,416 job URLs.
 *   - Google renders JS, but on a deferred second pass against a crawl budget.
 *     For a corpus this size most pages would never reach it.
 *   - JobPosting structured data was emitted into that blank page, so Google
 *     for Jobs had nothing to read. The markup existed and was unreachable.
 *   - Nothing painted until the bundle downloaded, parsed and hydrated, so
 *     first contentful paint was gated on JavaScript on every single visit.
 *
 * WHY IT WAS THERE, AND THE ACTUAL FIX
 * ------------------------------------
 * The gate suppresses the hydration warning next-themes produces because the
 * server cannot know the visitor's stored theme, so the class on <html> differs
 * between server and client. next-themes' documented answer is
 * `suppressHydrationWarning` on the <html> element -- it is in app/layout.tsx
 * now. That silences the one attribute genuinely allowed to differ, instead of
 * deleting the server render of the entire application to hide it.
 */
export function ClientRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ToastProvider>
        {/*
          Backdrop behind pages that do not paint their own.
          Every page here sets its own min-h-screen background, so this shows
          only in the gaps.

          The class list was previously:
            bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900
            dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900
            bg-white light:from-gray-50 light:via-purple-50/20 light:to-gray-50

          Three things were wrong with it. The `dark:` variants repeated the
          base values exactly, so they changed nothing. `light:` is not a
          configured variant in tailwind.config.ts, so those three classes did
          nothing at all. And `bg-white` sat under a gradient that always won --
          so the "light" background was dead code and the app was dark-gradient
          in both themes. This states the intent instead of implying one that
          never rendered.
        */}
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">{children}</div>
      </ToastProvider>
    </ThemeProvider>
  );
}
