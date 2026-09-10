"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, ArrowRight } from "lucide-react"

export default function AutoTypingSearch() {
  const [currentText, setCurrentText] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTyping, setIsTyping] = useState(true)

  const searchQueries = [
    "Find remote software engineer jobs at startups",
    "Search for data scientist positions in San Francisco",
    "Look for product manager roles at tech companies",
    "Find UX designer jobs with $100k+ salary",
    "Search for DevOps engineer positions at Fortune 500",
    "Find marketing manager roles in New York",
    "Look for AI engineer jobs at innovative companies",
    "Search for full-stack developer remote positions",
  ]

  useEffect(() => {
    const currentQuery = searchQueries[currentIndex]

    if (isTyping) {
      if (currentText.length < currentQuery.length) {
        const timeout = setTimeout(
          () => {
            setCurrentText(currentQuery.slice(0, currentText.length + 1))
          },
          50 + Math.random() * 50,
        ) // Variable typing speed for more natural feel

        return () => clearTimeout(timeout)
      } else {
        // Finished typing, wait then start deleting
        const timeout = setTimeout(() => {
          setIsTyping(false)
        }, 2000)

        return () => clearTimeout(timeout)
      }
    } else {
      if (currentText.length > 0) {
        const timeout = setTimeout(() => {
          setCurrentText(currentText.slice(0, -1))
        }, 30)

        return () => clearTimeout(timeout)
      } else {
        // Finished deleting, move to next query
        setCurrentIndex((prev) => (prev + 1) % searchQueries.length)
        setIsTyping(true)
      }
    }
  }, [currentText, currentIndex, isTyping, searchQueries])

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-2xl blur-xl"></div>
        <div className="relative bg-white/10 dark:bg-gray-800/50 backdrop-blur-sm border border-white/20 dark:border-gray-700/50 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <Search className="w-6 h-6 text-white" />
              </div>
            </div>

            <div className="flex-1 relative">
              <Input
                value={currentText}
                readOnly
                placeholder="Ask AI to find your perfect job..."
                className="text-lg bg-transparent border-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-0 focus:outline-none pr-16"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className={`w-0.5 h-6 bg-purple-500 ${isTyping ? "animate-pulse" : ""}`}></div>
              </div>
            </div>

            <Button className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl px-6 py-3 shadow-lg hover:shadow-purple-500/25 transition-all duration-200">
              <ArrowRight className="w-5 h-5" />
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm">
              AI-Powered
            </div>
            <div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              Smart Matching
            </div>
            <div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm">
              Auto-Apply
            </div>
          </div>
        </div>
      </div>

      <div className="text-center mt-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          ✨ AI understands your career goals and finds perfect matches
        </p>
      </div>
    </div>
  )
}
