"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatTime, formatCurrency, formatDateTime, getRelativeTime } from "@/lib/utils"

interface LocalizationDemoProps {
  preferences: {
    language?: string
    dateFormat?: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
    timeFormat?: '12h' | '24h'
    currency?: string
    timezone?: string
  }
}

export default function LocalizationDemo({ preferences }: LocalizationDemoProps) {
  const [demoAmount] = useState(1234.56)
  const [demoDate] = useState(new Date())
  const [pastDate] = useState(new Date(Date.now() - 2 * 60 * 60 * 1000)) // 2 hours ago

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Localization Preview</span>
          <Badge variant="outline">{preferences.language || 'en'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Date & Time</h4>
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <div>Date: {formatDate(demoDate, preferences)}</div>
              <div>Time: {formatTime(demoDate, preferences)}</div>
              <div>DateTime: {formatDateTime(demoDate, preferences)}</div>
              <div>Relative: {getRelativeTime(pastDate, preferences)}</div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Currency & Numbers</h4>
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <div>Amount: {formatCurrency(demoAmount, preferences)}</div>
              <div>Salary: {formatCurrency(75000, preferences)}</div>
              <div>Bonus: {formatCurrency(5000, preferences)}</div>
            </div>
          </div>
        </div>
        
        <div className="pt-2 border-t">
          <div className="text-xs text-gray-500">
            Settings: {preferences.dateFormat} | {preferences.timeFormat} | {preferences.currency}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
