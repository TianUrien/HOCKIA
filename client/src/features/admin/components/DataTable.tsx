/**
 * DataTable Component
 * 
 * Reusable table component with sorting and actions.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, MoreVertical } from 'lucide-react'

export interface Column<T> {
  key: keyof T | string
  label: string
  render?: (value: unknown, row: T) => React.ReactNode
  className?: string
}

export interface Action<T> {
  label: string
  icon?: React.ReactNode
  onClick: (row: T) => void
  variant?: 'default' | 'danger'
  disabled?: (row: T) => boolean
  /** Short reason shown under a disabled action. */
  disabledHint?: (row: T) => string | undefined
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  actions?: Action<T>[]
  keyField: keyof T
  loading?: boolean
  emptyMessage?: string
  pagination?: {
    page: number
    pageSize: number
    totalCount: number
    onPageChange: (page: number) => void
  }
}

export function DataTable<T extends object>({
  data,
  columns,
  actions,
  keyField,
  loading = false,
  emptyMessage = 'No data found',
  pagination,
}: DataTableProps<T>) {
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Close menu on scroll or resize
  useEffect(() => {
    const handleScroll = () => setOpenActionMenu(null)
    const handleResize = () => setOpenActionMenu(null)
    
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const openMenu = (rowKey: string) => {
    if (openActionMenu === rowKey) {
      setOpenActionMenu(null)
      setMenuPosition(null)
      return
    }
    
    const button = buttonRefs.current.get(rowKey)
    if (button) {
      const rect = button.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 140, // 140px is min-width of menu
      })
      setOpenActionMenu(rowKey)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="animate-pulse">
          {/* Header */}
          <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
            <div className="flex gap-4">
              {columns.map((_, i) => (
                <div key={i} className="h-4 w-24 bg-gray-200 rounded" />
              ))}
            </div>
          </div>
          {/* Rows */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border-b border-gray-100 px-4 py-3">
              <div className="flex gap-4">
                {columns.map((_, j) => (
                  <div key={j} className="h-4 w-24 bg-gray-100 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    )
  }

  const totalPages = pagination
    ? Math.ceil(pagination.totalCount / pagination.pageSize)
    : 1

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider ${
                    col.className || ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
              {actions && actions.length > 0 && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row) => {
              const rowKey = String(row[keyField])
              return (
                <tr key={rowKey} className="hover:bg-gray-50 transition-colors">
                  {columns.map((col) => {
                    const value = col.key.toString().includes('.')
                      ? col.key.toString().split('.').reduce((obj, key) => {
                          return (obj as Record<string, unknown>)?.[key]
                        }, row as unknown)
                      : row[col.key as keyof T]

                    return (
                      <td
                        key={String(col.key)}
                        className={`px-4 py-3 text-sm text-gray-900 ${
                          col.className || ''
                        }`}
                      >
                        {col.render ? col.render(value, row) : String(value ?? '-')}
                      </td>
                    )
                  })}
                  {actions && actions.length > 0 && (
                    <td className="px-4 py-3 text-right">
                      <button
                        ref={(el) => {
                          if (el) buttonRefs.current.set(rowKey, el)
                        }}
                        onClick={() => openMenu(rowKey)}
                        className="p-1 rounded hover:bg-gray-100 transition-colors"
                        aria-label="Open actions menu"
                        title="Actions"
                      >
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                      </button>
                      {openActionMenu === rowKey && menuPosition && createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => {
                              setOpenActionMenu(null)
                              setMenuPosition(null)
                            }}
                          />
                          <div 
                            className="fixed z-[101] bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]"
                            style={{ top: menuPosition.top, left: menuPosition.left }}
                          >
                            {actions.map((action, i) => {
                              const isDisabled = action.disabled?.(row) ?? false
                              const hint = isDisabled ? action.disabledHint?.(row) : undefined
                              return (
                                <div key={i}>
                                  <button
                                    onClick={() => {
                                      action.onClick(row)
                                      setOpenActionMenu(null)
                                      setMenuPosition(null)
                                    }}
                                    disabled={isDisabled}
                                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                                      action.variant === 'danger'
                                        ? 'text-red-600 hover:bg-red-50'
                                        : 'text-gray-700 hover:bg-gray-50'
                                    } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  >
                                    {action.icon}
                                    {action.label}
                                  </button>
                                  {hint && <p className="px-4 pb-2 text-xs text-gray-500">{hint}</p>}
                                </div>
                              )
                            })}
                          </div>
                        </>,
                        document.body
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
          <p className="text-sm text-gray-500">
            Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of{' '}
            {pagination.totalCount} results
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-gray-600">
              Page {pagination.page} of {totalPages}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
