/**
 * OutreachImportModal Component
 *
 * 3-step CSV import flow: Upload → Preview → Confirm.
 * Parses CSV in-browser using papaparse, validates required fields,
 * then calls bulk import RPC.
 */

import { useState, useCallback } from 'react'
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import Papa from 'papaparse'
import { bulkImportOutreachContacts } from '../api/outreachApi'
import type { OutreachImportResult } from '../types'
import { logger } from '@/lib/logger'

interface OutreachImportModalProps {
  onClose: () => void
  onImported: () => void
}

interface ParsedRow {
  email: string
  contact_name: string
  club_name: string
  country: string
  role_at_club: string
  phone: string
  instagram: string
  notes: string
}

interface ValidationResult {
  valid: ParsedRow[]
  errors: Array<{ row: number; message: string }>
}

type Step = 'upload' | 'preview' | 'result'

// Normalize header names (case-insensitive, trim whitespace, handle common aliases)
function normalizeHeader(header: string): string {
  const h = header.trim().toLowerCase().replace(/[\s_-]+/g, '_')
  const aliases: Record<string, string> = {
    email: 'email',
    email_address: 'email',
    e_mail: 'email',
    name: 'contact_name',
    contact_name: 'contact_name',
    contact: 'contact_name',
    person: 'contact_name',
    club: 'club_name',
    club_name: 'club_name',
    team: 'club_name',
    team_name: 'club_name',
    country: 'country',
    nation: 'country',
    role: 'role_at_club',
    role_at_club: 'role_at_club',
    position: 'role_at_club',
    phone: 'phone',
    telephone: 'phone',
    phone_number: 'phone',
    instagram: 'instagram',
    ig: 'instagram',
    instagram_handle: 'instagram',
    social: 'instagram',
    notes: 'notes',
    note: 'notes',
    comments: 'notes',
  }
  return aliases[h] || h
}

function validateRows(rows: Record<string, string>[]): ValidationResult {
  const valid: ParsedRow[] = []
  const errors: Array<{ row: number; message: string }> = []

  rows.forEach((row, index) => {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = value?.trim() || ''
    }

    const email = normalized.email || ''
    const club_name = normalized.club_name || ''

    if (!email) {
      errors.push({ row: index + 2, message: 'Missing email' })
      return
    }
    if (!email.includes('@')) {
      errors.push({ row: index + 2, message: `Invalid email: ${email}` })
      return
    }
    if (!club_name) {
      errors.push({ row: index + 2, message: 'Missing club name' })
      return
    }

    valid.push({
      email,
      contact_name: normalized.contact_name || '',
      club_name,
      country: normalized.country || '',
      role_at_club: normalized.role_at_club || '',
      phone: normalized.phone || '',
      instagram: (normalized.instagram || '').replace(/^@/, ''),
      notes: normalized.notes || '',
    })
  })

  return { valid, errors }
}

export function OutreachImportModal({ onClose, onImported }: OutreachImportModalProps) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<OutreachImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback((file: File) => {
    setFileName(file.name)
    setError(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(`CSV parse error: ${results.errors[0].message}`)
          return
        }
        const data = results.data as Record<string, string>[]
        if (data.length === 0) {
          setError('CSV file is empty')
          return
        }
        const v = validateRows(data)
        setValidation(v)
        setStep('preview')
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`)
      },
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleFile(file)
    } else {
      setError('Please drop a .csv file')
    }
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleImport = async () => {
    if (!validation || validation.valid.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const data = await bulkImportOutreachContacts(validation.valid)
      setResult(data)
      setStep('result')
    } catch (err) {
      logger.error('[OutreachImportModal] Import failed:', err)
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'upload' && 'Import Contacts'}
            {step === 'preview' && 'Preview Import'}
            {step === 'result' && 'Import Complete'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition-colors cursor-pointer"
                onClick={() => document.getElementById('csv-file-input')?.click()}
              >
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700">
                  Drop a CSV file here, or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Required columns: email, club_name
                </p>
                <p className="text-xs text-gray-400">
                  Optional: contact_name, country, role_at_club, instagram, phone, notes
                </p>
                <input
                  id="csv-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileInput}
                  className="hidden"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && validation && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-purple-600" />
                <span className="text-sm font-medium text-gray-700">{fileName}</span>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-green-700">{validation.valid.length}</p>
                  <p className="text-xs text-green-600">Valid rows</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-red-700">{validation.errors.length}</p>
                  <p className="text-xs text-red-600">Errors</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-gray-700">
                    {validation.valid.length + validation.errors.length}
                  </p>
                  <p className="text-xs text-gray-600">Total rows</p>
                </div>
              </div>

              {/* Errors */}
              {validation.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 mb-1">
                    {validation.errors.length} row{validation.errors.length !== 1 ? 's' : ''} will be skipped:
                  </p>
                  <div className="max-h-24 overflow-y-auto space-y-0.5">
                    {validation.errors.slice(0, 10).map((e, i) => (
                      <p key={i} className="text-xs text-red-600">
                        Row {e.row}: {e.message}
                      </p>
                    ))}
                    {validation.errors.length > 10 && (
                      <p className="text-xs text-red-500">
                        ...and {validation.errors.length - 10} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Preview table (first 10 valid rows) */}
              {validation.valid.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Name</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Club</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.valid.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-700 font-mono">{row.email}</td>
                          <td className="px-3 py-2 text-gray-600">{row.contact_name || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row.club_name}</td>
                          <td className="px-3 py-2 text-gray-500">{row.country || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validation.valid.length > 10 && (
                    <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                      ...and {validation.valid.length - 10} more rows
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Result */}
          {step === 'result' && result && (
            <div className="space-y-4 text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {result.imported} contact{result.imported !== 1 ? 's' : ''} imported
                </p>
                {result.skipped > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    {result.skipped} skipped (duplicate emails)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          {step === 'upload' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          )}
          {step === 'preview' && (
            <>
              <button
                onClick={() => { setStep('upload'); setValidation(null); setError(null) }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !validation || validation.valid.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                Import {validation?.valid.length ?? 0} Contact{(validation?.valid.length ?? 0) !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'result' && (
            <button
              onClick={onImported}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
