import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2, Plus, AlertTriangle } from 'lucide-react'
import {
  getAllCountries,
  createWorldProvince,
  updateWorldProvince,
} from '../api/adminApi'
import type {
  WorldProvinceAdmin,
  WorldCountry,
} from '../types'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'

interface EditWorldRegionModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  region: WorldProvinceAdmin | null // null = creating new
}

export function EditWorldRegionModal({
  isOpen,
  onClose,
  onSaved,
  region,
}: EditWorldRegionModalProps) {
  const isCreating = region === null

  // Form state
  const [name, setName] = useState('')
  const [countryId, setCountryId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [displayOrder, setDisplayOrder] = useState(0)

  // Dropdown data
  const [countries, setCountries] = useState<WorldCountry[]>([])

  // Loading states
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[EditWorldRegionModal] Failed to load countries:', err)
    } finally {
      setLoadingCountries(false)
    }
  }, [])

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (region) {
        setName(region.name)
        setCountryId(region.country_id)
        setDescription(region.description ?? '')
        setDisplayOrder(region.display_order)
      } else {
        setName('')
        setCountryId(null)
        setDescription('')
        setDisplayOrder(0)
      }
      setError(null)
      loadCountries()
    }
  }, [isOpen, region, loadCountries])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Region name is required')
      return
    }
    if (!countryId) {
      setError('Country is required')
      return
    }

    setIsSubmitting(true)

    try {
      if (isCreating) {
        await createWorldProvince({
          name: name.trim(),
          country_id: countryId,
          description: description.trim() || null,
          display_order: displayOrder,
        })
      } else {
        await updateWorldProvince(region.id, {
          name: name.trim(),
          country_id: countryId,
          description: description.trim() || null,
          display_order: displayOrder,
        })
      }

      onSaved()
      onClose()
    } catch (err) {
      logger.error('[EditWorldRegionModal] Save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save region')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

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
            {isCreating ? 'Add New Region' : 'Edit Region'}
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

          {/* Region Name */}
          <div>
            <label htmlFor="region-name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Region Name <span className="text-red-500">*</span>
            </label>
            <input
              id="region-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter region name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
              required
            />
            {!isCreating && region && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-gray-500">
                  Slug: <span className="font-mono">{region.slug}</span> (auto-generated)
                </p>
                {region.logical_id && (
                  <p className="text-xs text-gray-500">
                    Logical ID: {region.logical_id} (read-only)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Country */}
          <div>
            <label htmlFor="region-country" className="block text-sm font-medium text-gray-700 mb-1.5">
              Country <span className="text-red-500">*</span>
            </label>
            <select
              id="region-country"
              value={countryId ?? ''}
              onChange={(e) => setCountryId(e.target.value ? parseInt(e.target.value, 10) : null)}
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

          {/* Description */}
          <div>
            <label htmlFor="region-description" className="block text-sm font-medium text-gray-700 mb-1.5">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="region-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this region"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Display Order */}
          <div>
            <label htmlFor="region-order" className="block text-sm font-medium text-gray-700 mb-1.5">
              Display Order <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="region-order"
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Read-only info for existing regions */}
          {!isCreating && region && (
            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-1">
                <strong>Created:</strong> {formatAdminDate(region.created_at)}
              </p>
              <p className="text-xs text-gray-500">
                <strong>Last Updated:</strong> {formatAdminDate(region.updated_at)}
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
                  {isCreating ? 'Add Region' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
