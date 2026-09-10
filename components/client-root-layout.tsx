"use client";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast-provider";
import React, { useEffect, useState } from "react";

export function ClientRootLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ToastProvider>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900 bg-white light:from-gray-50 light:via-purple-50/20 light:to-gray-50">
          {children}
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}