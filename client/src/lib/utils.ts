import { type ClassValue, clsx } from 'clsx'

/**
 * Utility function to merge class names
 * Combines clsx for conditional classes
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * Parse a date-only string (YYYY-MM-DD) without timezone conversion.
 * 
 * JavaScript's `new Date("YYYY-MM-DD")` interprets the string as UTC midnight,
 * which causes the date to shift by -1 day when displayed in timezones behind UTC.
 * 
 * This function parses the date components and creates a local Date object,
 * ensuring the date displays exactly as stored.
 * 
 * @param dateString - A date string in YYYY-MM-DD format (e.g., "1993-02-26")
 * @returns A Date object set to midnight in the local timezone, or null if invalid
 */
export function parseDateOnly(dateString: string | null | undefined): Date | null {
  if (!dateString) return null
  
  // Handle ISO datetime strings (with time component) - use as-is
  if (dateString.includes('T')) {
    const d = new Date(dateString)
    return Number.isNaN(d.getTime()) ? null : d
  }
  
  // Parse YYYY-MM-DD format without timezone conversion
  // Validate strictly to avoid rollover dates like 2025-02-31.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null

  const [yearStr, monthStr, dayStr] = dateString.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  // Create date using local timezone (month is 0-indexed)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null

  // Ensure the constructed date matches the input components exactly (no rollover)
  if (date.getFullYear() !== year) return null
  if (date.getMonth() !== month - 1) return null
  if (date.getDate() !== day) return null

  return date
}

/**
 * Format date to readable string.
 * Handles date-only strings (YYYY-MM-DD) correctly without timezone shift.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) ?? new Date(date) : date
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

/**
 * Format a date of birth string for display.
 * Ensures no timezone shift occurs for date-only values.
 * 
 * @param dateOfBirth - Date string in YYYY-MM-DD format
 * @returns Formatted date string (e.g., "February 26, 1993") or null if invalid
 */
export function formatDateOfBirth(dateOfBirth: string | null | undefined): string | null {
  const date = parseDateOnly(dateOfBirth)
  if (!date) return null
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/**
 * Calculate age from a date of birth string.
 * Handles date-only strings correctly without timezone shift.
 * 
 * @param dateOfBirth - Date string in YYYY-MM-DD format
 * @returns Age in years, or null if invalid
 */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  const birthDate = parseDateOnly(dateOfBirth)
  if (!birthDate) return null
  
  const today = new Date()
  // Guard against future dates producing negative ages
  if (birthDate.getTime() > today.getTime()) return null

  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  
  return age
}

/**
 * Debounce function for search inputs
 */
export function debounce<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  wait: number
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout | null = null

  return function executedFunction(...args: TArgs) {
    const later = () => {
      timeout = null
      func(...args)
    }

    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(later, wait)
  }
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Truncate text to specified length
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

/**
 * Generate random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

/**
 * Human-readable relative time string.
 *
 * @param dateString  ISO timestamp
 * @param compact     If true  → "5m ago", "3h ago", "2d ago"
 *                    If false → "5 minutes ago", "3 hours ago", "2 days ago"
 */
export function getTimeAgo(dateString: string, compact = false): string {
  const now = new Date()
  const date = new Date(dateString)
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (compact) {
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)

  if (minutes < 5) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  return formatDate(dateString)
}

/**
 * Extract a user-friendly error message from Supabase or network errors.
 *
 * Technical DB/network errors are mapped to plain-English messages.
 * Only returns the raw message if it looks safe for end-users.
 * Falls back to the provided default otherwise.
 */

const TECHNICAL_ERROR_MAP: [RegExp, string][] = [
  [/row-level security/i, 'You don\'t have permission to do that.'],
  [/duplicate key|unique.?constraint|already exists/i, 'This already exists. Try refreshing the page.'],
  [/violates check constraint/i, 'Some of the data provided is invalid. Please review and try again.'],
  [/violates foreign key/i, 'A related record is missing or was deleted.'],
  [/not found|does not exist/i, 'The item was not found — it may have been deleted.'],
  [/rate limit|too many requests|429/i, 'Too many requests. Please wait a moment and try again.'],
  [/timeout|timed out|deadline exceeded/i, 'The request timed out. Please try again.'],
  [/network|fetch|ERR_INTERNET|ECONNREFUSED|ENOTFOUND/i, 'Network error. Please check your connection and try again.'],
  [/JWT|token.*expired|auth.*expired/i, 'Your session has expired. Please sign in again.'],
  [/FetchError/i, 'Network error. Please check your connection and try again.'],
]

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback

  // Extract the raw message string
  let raw = ''
  if (error instanceof Error) {
    raw = error.message ?? ''
  } else if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') raw = obj.message
    else if (typeof obj.error_description === 'string') raw = obj.error_description
  }

  if (!raw) return fallback

  // Map known technical patterns to user-friendly messages
  for (const [pattern, friendly] of TECHNICAL_ERROR_MAP) {
    if (pattern.test(raw)) return friendly
  }

  // If the raw message is short and doesn't look like a stack trace or SQL,
  // it's probably already user-friendly (e.g. from our own RPCs)
  const looksTechnical = /postgres|sql|supabase|pgrst|pg_|constraint|relation|column|schema|operator/i.test(raw)
  if (!looksTechnical && raw.length < 200) return raw

  return fallback
}
