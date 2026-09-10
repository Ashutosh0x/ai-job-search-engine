import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// User preferences interface for formatting
interface UserPreferences {
  language?: string
  dateFormat?: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
  timeFormat?: '12h' | '24h'
  currency?: string
  timezone?: string
}

// Format date according to user preferences
export function formatDate(date: Date | string, preferences: UserPreferences = {}): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const { language = 'en', dateFormat = 'MM/DD/YYYY' } = preferences

  if (dateFormat === 'YYYY-MM-DD') {
    return dateObj.toISOString().split('T')[0]
  }

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }

  const formatted = dateObj.toLocaleDateString(language, options)
  
  if (dateFormat === 'DD/MM/YYYY') {
    // Convert MM/DD/YYYY to DD/MM/YYYY
    const parts = formatted.split('/')
    if (parts.length === 3) {
      return `${parts[1]}/${parts[0]}/${parts[2]}`
    }
  }
  
  return formatted
}

// Format time according to user preferences
export function formatTime(date: Date | string, preferences: UserPreferences = {}): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const { language = 'en', timeFormat = '12h' } = preferences

  const options: Intl.DateTimeFormatOptions = {
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h'
  }

  return dateObj.toLocaleTimeString(language, options)
}

// Format currency according to user preferences
export function formatCurrency(amount: number, preferences: UserPreferences = {}): string {
  const { language = 'en', currency = 'USD' } = preferences

  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: currency
  }).format(amount)
}

// Format date and time together
export function formatDateTime(date: Date | string, preferences: UserPreferences = {}): string {
  const dateStr = formatDate(date, preferences)
  const timeStr = formatTime(date, preferences)
  return `${dateStr} ${timeStr}`
}

// Get relative time (e.g., "2 hours ago", "3 days ago")
export function getRelativeTime(date: Date | string, preferences: UserPreferences = {}): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000)
  
  const { language = 'en' } = preferences
  
  if (diffInSeconds < 60) {
    return language === 'en' ? 'Just now' : '방금 전'
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return language === 'en' 
      ? `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`
      : `${diffInMinutes}분 전`
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return language === 'en'
      ? `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`
      : `${diffInHours}시간 전`
  }
  
  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) {
    return language === 'en'
      ? `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`
      : `${diffInDays}일 전`
  }
  
  const diffInWeeks = Math.floor(diffInDays / 7)
  if (diffInWeeks < 4) {
    return language === 'en'
      ? `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`
      : `${diffInWeeks}주 전`
  }
  
  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) {
    return language === 'en'
      ? `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`
      : `${diffInMonths}개월 전`
  }
  
  const diffInYears = Math.floor(diffInDays / 365)
  return language === 'en'
    ? `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`
    : `${diffInYears}년 전`
}
