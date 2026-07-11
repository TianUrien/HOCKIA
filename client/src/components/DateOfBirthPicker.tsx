import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DateOfBirthPickerProps {
  label?: string
  value: string
  onChange: (next: string) => void
  required?: boolean
  icon?: ReactNode
  error?: string
  /** Inclusive. Defaults to current year - 4. */
  maxYear?: number
  /** Inclusive. Defaults to current year - 100. */
  minYear?: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Parts = { year: number | null; month: number | null; day: number | null }

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number | null, month: number | null) {
  if (!month) return 31
  if (month === 2) return year ? (isLeapYear(year) ? 29 : 28) : 29
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function parseValue(value: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return { year: null, month: null, day: null }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function serialize({ year, month, day }: Parts): string {
  if (!year || !month || !day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function DateOfBirthPicker({
  label,
  value,
  onChange,
  required = false,
  icon,
  error,
  maxYear = new Date().getFullYear() - 4,
  minYear = new Date().getFullYear() - 100,
}: DateOfBirthPickerProps) {
  const labelId = useId()
  const errorId = error ? `${labelId}-error` : undefined

  // Local state preserves partial selections (e.g., year-only) that wouldn't
  // round-trip through the parent's controlled `value` prop, which only holds
  // a fully-formed ISO date or ''.
  const [parts, setParts] = useState<Parts>(() => parseValue(value))

  // Sync from external value when it diverges from our internal serialization —
  // e.g., parent reset the form or loaded a profile after mount.
  useEffect(() => {
    if (serialize(parts) !== value) {
      setParts(parseValue(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const { year, month, day } = parts

  const years = useMemo(() => {
    const arr: number[] = []
    for (let y = maxYear; y >= minYear; y--) arr.push(y)
    return arr
  }, [maxYear, minYear])

  const dayCount = daysInMonth(year, month)
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount])

  function update(patch: Partial<Parts>) {
    const merged: Parts = { ...parts, ...patch }
    // If year/month change shrinks the valid day range, clear the day rather than
    // silently writing the wrong birthday (e.g., Feb 29 in a non-leap year).
    const maxDay = daysInMonth(merged.year, merged.month)
    if (merged.day && merged.day > maxDay) merged.day = null
    setParts(merged)
    onChange(serialize(merged))
  }

  const selectClassName = cn(
    'w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-lg',
    'focus:outline-none focus:ring-2 focus:ring-hockia-primary focus:border-transparent',
    'transition-all duration-200 text-gray-700',
    error && 'border-red-500 focus:ring-red-500',
  )

  return (
    <div className="space-y-2">
      {label && (
        <span id={labelId} className="flex items-center gap-2 text-sm font-medium text-gray-700">
          {icon && <span className="text-gray-400">{icon}</span>}
          <span>
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </span>
        </span>
      )}
      <div role="group" aria-labelledby={label ? labelId : undefined} className="grid grid-cols-3 gap-2">
        <select
          aria-label="Day"
          className={selectClassName}
          value={day ?? ''}
          onChange={(e) => update({ day: e.target.value ? Number(e.target.value) : null })}
          {...(errorId && { 'aria-describedby': errorId })}
        >
          <option value="">Day</option>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="Month"
          className={selectClassName}
          value={month ?? ''}
          onChange={(e) => update({ month: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Year"
          className={selectClassName}
          value={year ?? ''}
          onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      {error && (
        <p className="text-sm text-red-500" id={errorId}>{error}</p>
      )}
    </div>
  )
}

export default DateOfBirthPicker
