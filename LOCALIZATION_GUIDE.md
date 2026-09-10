# Localization & Internationalization Guide

## Overview

The app now supports comprehensive localization features including language selection, date/time formatting, currency display, and timezone management. All settings are stored in the user's profile preferences and automatically applied throughout the application.

## Features Implemented

### 1. Language Selection
- **Supported Languages**: English, Spanish, French, German, Chinese, Japanese, Korean, Portuguese, Italian, Russian, Arabic, Hindi
- **Storage**: Stored in `user.preferences.language`
- **Default**: English (`en`)

### 2. Date Format Options
- **MM/DD/YYYY** (US format)
- **DD/MM/YYYY** (European format)  
- **YYYY-MM-DD** (ISO format)
- **Storage**: Stored in `user.preferences.dateFormat`
- **Default**: MM/DD/YYYY

### 3. Time Format Options
- **12-hour** (AM/PM)
- **24-hour** (military time)
- **Storage**: Stored in `user.preferences.timeFormat`
- **Default**: 12-hour

### 4. Currency Options
- **Supported**: USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR
- **Storage**: Stored in `user.preferences.currency`
- **Default**: USD

### 5. Timezone Selection
- **Major timezones** from all continents
- **Storage**: Stored in `user.preferences.timezone`
- **Default**: User's browser timezone

## Usage in Components

### Import the formatting functions
```typescript
import { 
  formatDate, 
  formatTime, 
  formatCurrency, 
  formatDateTime, 
  getRelativeTime 
} from "@/lib/utils"
```

### Get user preferences
```typescript
// In your component
const { data: profile } = await supabase
  .from('profiles')
  .select('preferences')
  .eq('id', user.id)
  .single()

const preferences = profile?.preferences || {}
```

### Format dates and times
```typescript
// Format a date
const formattedDate = formatDate(new Date(), preferences)

// Format time
const formattedTime = formatTime(new Date(), preferences)

// Format date and time together
const formattedDateTime = formatDateTime(new Date(), preferences)

// Get relative time (e.g., "2 hours ago")
const relativeTime = getRelativeTime(pastDate, preferences)
```

### Format currency
```typescript
// Format currency amounts
const formattedSalary = formatCurrency(75000, preferences)
const formattedBonus = formatCurrency(5000, preferences)
```

## Example Implementation

```typescript
// In a job listing component
function JobCard({ job, userPreferences }) {
  return (
    <div className="job-card">
      <h3>{job.title}</h3>
      <p>Posted: {formatDate(job.posted_time, userPreferences)}</p>
      <p>Salary: {formatCurrency(job.salary, userPreferences)}</p>
      <p>Time ago: {getRelativeTime(job.posted_time, userPreferences)}</p>
    </div>
  )
}
```

## Settings Page Integration

The localization settings are available in the Settings page under the "Preferences" tab. Users can:

1. **Select Language**: Choose from 12 supported languages
2. **Set Date Format**: Choose between US, European, or ISO formats
3. **Set Time Format**: Choose between 12-hour and 24-hour formats
4. **Select Currency**: Choose from 9 major currencies
5. **Set Timezone**: Choose from major world timezones

## Database Schema

User preferences are stored in the `profiles` table:

```sql
-- The preferences column is JSONB and contains:
{
  "language": "en",
  "dateFormat": "MM/DD/YYYY",
  "timeFormat": "12h",
  "currency": "USD",
  "timezone": "America/New_York"
}
```

## Best Practices

1. **Always use the formatting functions** instead of native JavaScript date/currency formatting
2. **Pass user preferences** to all formatting functions
3. **Handle missing preferences** gracefully with sensible defaults
4. **Test with different locales** to ensure proper formatting
5. **Consider RTL languages** for future Arabic/Hebrew support

## Future Enhancements

- [ ] RTL (Right-to-Left) language support
- [ ] More currency options
- [ ] Custom date/time formats
- [ ] Regional number formatting (decimal separators, thousands separators)
- [ ] Translation files for UI text
- [ ] Automatic language detection based on browser settings
