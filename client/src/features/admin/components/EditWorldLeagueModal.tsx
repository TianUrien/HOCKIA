import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2, Plus, AlertTriangle } from 'lucide-react'
import {
  getAllCountries,
  getWorldProvinces,
  createWorldLeague,
  updateWorldLeague,
} from '../api/adminApi'
import type {
  WorldLeagueAdmin,
  WorldCountry,
  WorldProvince,
} from '../types'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'

interface EditWorldLeagueModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  league: WorldLeagueAdmin | null // null = creating new
}

export function EditWorldLeagueModal({
  isOpen,
  onClose,
  onSaved,
  league,
}: EditWorldLeagueModalProps) {
  const isCreating = league === null

  // Form state
  const [name, setName] = useState('')
  const [countryId, setCountryId] = useState<number | null>(null)
  const [provinceId, setProvinceId] = useState<number | null>(null)
  const [tier, setTier] = useState<number | null>(null)
  const [displayOrder, setDisplayOrder] = useState(0)

  // Dropdown data
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [provinces, setProvinces] = useState<WorldProvince[]>([])

  // Loading states
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [loadingProvinces, setLoadingProvinces] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[EditWorldLeagueModal] Failed to load countries:', err)
    } finally {
      setLoadingCountries(false)
    }
  }, [])

  const loadProvinces = useCallback(async (cId: number) => {
    setLoadingProvinces(true)
    try {
      const data = await getWorldProvinces(cId)
      setProvinces(data)
    } catch (err) {
      logger.error('[EditWorldLeagueModal] Failed to load provinces:', err)
      setProvinces([])
    } finally {
      setLoadingProvinces(false)
    }
  }, [])

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (league) {
        setName(league.name)
        setCountryId(league.country_id)
        setProvinceId(league.province_id)
        setTier(league.tier)
        setDisplayOrder(league.display_order)
      } else {
        setName('')
        setCountryId(null)
        setProvinceId(null)
        setTier(null)
        setDisplayOrder(0)
      }
      setError(null)
      loadCountries()
    }
  }, [isOpen, league, loadCountries])

  // Load provinces when country changes
  useEffect(() => {
    if (countryId) {
      loadProvinces(countryId)
    } else {
      setProvinces([])
      setProvinceId(null)
    }
  }, [countryId, loadProvinces])

  const handleCountryChange = (value: string) => {
    const id = value ? parseInt(value, 10) : null
    setCountryId(id)
    setProvinceId(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('League name is required')
      return
    }
    if (!countryId) {
      setError('Country is required')
      return
    }

    setIsSubmitting(true)

    try {
      if (isCreating) {
        await createWorldLeague({
          name: name.trim(),
          country_id: countryId,
          province_id: provinceId,
          tier,
          display_order: displayOrder,
        })
      } else {
        await updateWorldLeague(league.id, {
          name: name.trim(),
          country_id: countryId,
          province_id: provinceId,
          tier,
          display_order: displayOrder,
        })
      }

      onSaved()
      onClose()
    } catch (err) {
      logger.error('[EditWorldLeagueModal] Save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save league')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const hasProvinces = provinces.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isCreating ? 'Add New League' : 'Edit League'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* League Name */}
          <div>
            <label htmlFor="league-name" className="block text-sm font-medium text-gray-700 mb-1.5">
              League Name <span className="text-red-500">*</span>
            </label>
            <input
              id="league-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter league name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
              required
            />
            {!isCreating && league?.logical_id && (
              <p className="mt-1 text-xs text-gray-500">
                Logical ID: {league.logical_id} (read-only)
              </p>
            )}
          </div>

          {/* Country */}
          <div>
            <label htmlFor="league-country" className="block text-sm font-medium text-gray-700 mb-1.5">
              Country <span className="text-red-500">*</span>
            </label>
            <select
              id="league-country"
              value={countryId ?? ''}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
              disabled={loadingCountries}
              required
            >
              <option value="">Select country...</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.flag_emoji} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Region */}
          {countryId && (
            <div>
              <label htmlFor="league-region" className="block text-sm font-medium text-gray-700 mb-1.5">
                Region <span className="text-gray-400">(optional)</span>
              </label>
              {loadingProvinces ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading regions...
                </div>
              ) : hasProvinces ? (
                <select
                  id="league-region"
                  value={provinceId ?? ''}
                  onChange={(e) => setProvinceId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                >
                  <option value="">No region / National level</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-500 py-2">
                  This country doesn&apos;t have regions
                </p>
              )}
            </div>
          )}

          {/* Tier */}
          <div>
            <label htmlFor="league-tier" className="block text-sm font-medium text-gray-700 mb-1.5">
              Tier <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="league-tier"
              type="number"
              min={1}
              max={10}
              value={tier ?? ''}
              onChange={(e) => setTier(e.target.value ? parseInt(e.target.value, 10) : null)}
              placeholder="e.g. 1 (premier), 2 (second), ..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Display Order */}
          <div>
            <label htmlFor="league-order" className="block text-sm font-medium text-gray-700 mb-1.5">
              Display Order <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="league-order"
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Read-only info for existing leagues */}
          {!isCreating && league && (
            <div className="pt-3 border-t border-gray-200">
              {league.slug && (
                <p className="text-xs text-gray-500 mb-1">
                  <strong>Slug:</strong> {league.slug}
                </p>
              )}
              <p className="text-xs text-gray-500 mb-1">
                <strong>Created:</strong> {formatAdminDate(league.created_at)}
              </p>
              <p className="text-xs text-gray-500">
                <strong>Last Updated:</strong> {formatAdminDate(league.updated_at)}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  {isCreating ? <Plus className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {isCreating ? 'Add League' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
