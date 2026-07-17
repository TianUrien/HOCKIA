/**
 * EditWorldClubModal Component
 * 
 * Modal for editing or creating world clubs in the Admin Portal.
 * Supports cascading dropdowns: Country → Region → Leagues
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Save, Loader2, Plus, AlertTriangle, Upload, Trash2, Shield } from 'lucide-react'
import { formatAdminDate } from '../utils/formatDate'
import {
  getAllCountries,
  getWorldProvinces,
  getWorldLeagues,
  createWorldClub,
  updateWorldClub,
} from '../api/adminApi'
import type {
  WorldClub,
  WorldCountry,
  WorldProvince,
  WorldLeague,
} from '../types'
import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { deleteStorageObject } from '@/lib/storage'
import { optimizeAvatarImage } from '@/lib/imageOptimization'

interface EditWorldClubModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  club: WorldClub | null // null = creating new club
}

export function EditWorldClubModal({
  isOpen,
  onClose,
  onSaved,
  club,
}: EditWorldClubModalProps) {
  const isCreating = club === null
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [clubName, setClubName] = useState('')
  const [countryId, setCountryId] = useState<number | null>(null)
  const [provinceId, setProvinceId] = useState<number | null>(null)
  const [menLeagueId, setMenLeagueId] = useState<number | null>(null)
  const [womenLeagueId, setWomenLeagueId] = useState<number | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState<string | null>(null)

  // Dropdown data
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [provinces, setProvinces] = useState<WorldProvince[]>([])
  const [leagues, setLeagues] = useState<WorldLeague[]>([])

  // Loading states
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [loadingProvinces, setLoadingProvinces] = useState(false)
  const [loadingLeagues, setLoadingLeagues] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[EditWorldClubModal] Failed to load countries:', err)
    } finally {
      setLoadingCountries(false)
    }
  }, [])

  const loadProvinces = useCallback(async (cId: number) => {
    setLoadingProvinces(true)
    try {
      const data = await getWorldProvinces(cId)
      setProvinces(data)
      // If editing and province doesn't match new country, clear it
      if (club && club.country_id !== cId) {
        setProvinceId(null)
      }
    } catch (err) {
      logger.error('[EditWorldClubModal] Failed to load provinces:', err)
      setProvinces([])
    } finally {
      setLoadingProvinces(false)
    }
  }, [club])

  const loadLeagues = useCallback(async (cId: number, pId: number | null) => {
    setLoadingLeagues(true)
    try {
      const data = await getWorldLeagues(cId, pId)
      setLeagues(data)
      // If leagues don't include current selection, clear it
      const leagueIds = new Set(data.map(l => l.id))
      if (menLeagueId && !leagueIds.has(menLeagueId)) {
        setMenLeagueId(null)
      }
      if (womenLeagueId && !leagueIds.has(womenLeagueId)) {
        setWomenLeagueId(null)
      }
    } catch (err) {
      logger.error('[EditWorldClubModal] Failed to load leagues:', err)
      setLeagues([])
    } finally {
      setLoadingLeagues(false)
    }
  }, [menLeagueId, womenLeagueId])

  // Initialize form when modal opens or club changes
  useEffect(() => {
    if (isOpen) {
      if (club) {
        // Editing existing club
        setClubName(club.club_name)
        setCountryId(club.country_id)
        setProvinceId(club.province_id)
        setMenLeagueId(club.men_league_id)
        setWomenLeagueId(club.women_league_id)
        setAvatarUrl(club.avatar_url ?? null)
        setOriginalAvatarUrl(club.avatar_url ?? null)
      } else {
        // Creating new club
        setClubName('')
        setCountryId(null)
        setProvinceId(null)
        setMenLeagueId(null)
        setWomenLeagueId(null)
        setAvatarUrl(null)
        setOriginalAvatarUrl(null)
      }
      setError(null)
      loadCountries()
    }
  }, [isOpen, club, loadCountries])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input so same file can be re-selected
    e.target.value = ''

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Only JPG and PNG files are allowed')
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB')
      return
    }

    // For new clubs, we need the club ID first — store as local preview
    if (isCreating) {
      // Store file for upload after creation
      const previewUrl = URL.createObjectURL(file)
      setAvatarUrl(previewUrl)
      // Store the file in a ref for later upload
      pendingFileRef.current = file
      return
    }

    // For existing clubs, upload immediately
    await uploadFile(file, club!.id)
  }

  const pendingFileRef = useRef<File | null>(null)

  const uploadFile = async (file: File, clubId: string) => {
    setIsUploading(true)
    setError(null)

    try {
      // Optimize to 512x512 square before uploading
      const optimized = await optimizeAvatarImage(file)
      const ext = optimized.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${clubId}/${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('world-club-logos')
        .upload(path, optimized, { upsert: true, cacheControl: '31536000' })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('world-club-logos')
        .getPublicUrl(path)

      setAvatarUrl(urlData.publicUrl)
    } catch (err) {
      logger.error('[EditWorldClubModal] Upload failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (avatarUrl && !avatarUrl.startsWith('blob:')) {
      // Delete from storage
      await deleteStorageObject({
        bucket: 'world-club-logos',
        publicUrl: avatarUrl,
        context: 'admin-remove-club-logo',
      })
    }
    setAvatarUrl(null)
    pendingFileRef.current = null
  }

  // Load provinces when country changes
  useEffect(() => {
    if (countryId) {
      loadProvinces(countryId)
    } else {
      setProvinces([])
      setProvinceId(null)
    }
  }, [countryId, loadProvinces])

  // Load leagues when country/province changes
  useEffect(() => {
    if (countryId) {
      loadLeagues(countryId, provinceId)
    } else {
      setLeagues([])
      setMenLeagueId(null)
      setWomenLeagueId(null)
    }
  }, [countryId, provinceId, loadLeagues])

  const handleCountryChange = (value: string) => {
    const id = value ? parseInt(value, 10) : null
    setCountryId(id)
    setProvinceId(null)
    setMenLeagueId(null)
    setWomenLeagueId(null)
  }

  const handleProvinceChange = (value: string) => {
    const id = value ? parseInt(value, 10) : null
    setProvinceId(id)
    setMenLeagueId(null)
    setWomenLeagueId(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!clubName.trim()) {
      setError('Club name is required')
      return
    }
    if (!countryId) {
      setError('Country is required')
      return
    }

    setIsSubmitting(true)

    try {
      if (isCreating) {
        // Create new club
        const newClub = await createWorldClub({
          club_name: clubName.trim(),
          country_id: countryId,
          province_id: provinceId,
          men_league_id: menLeagueId,
          women_league_id: womenLeagueId,
        })

        // If a file was pending, upload it now that we have the club ID
        if (pendingFileRef.current && newClub?.id) {
          const optimized = await optimizeAvatarImage(pendingFileRef.current)
          const ext = optimized.name.split('.').pop()?.toLowerCase() || 'jpg'
          const path = `${newClub.id}/${Date.now()}.${ext}`

          const { error: uploadError } = await supabase.storage
            .from('world-club-logos')
            .upload(path, optimized, { upsert: true, cacheControl: '31536000' })

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('world-club-logos')
              .getPublicUrl(path)
            await updateWorldClub(newClub.id, { avatar_url: urlData.publicUrl })
          } else {
            logger.error('[EditWorldClubModal] Upload after create failed:', uploadError)
          }
          pendingFileRef.current = null
        }
      } else {
        // Delete old avatar from storage if it was replaced or removed
        if (originalAvatarUrl && originalAvatarUrl !== avatarUrl) {
          await deleteStorageObject({
            bucket: 'world-club-logos',
            publicUrl: originalAvatarUrl,
            context: 'admin-replace-club-logo',
          })
        }

        // Update existing club
        await updateWorldClub(club.id, {
          club_name: clubName.trim(),
          country_id: countryId,
          province_id: provinceId,
          men_league_id: menLeagueId,
          women_league_id: womenLeagueId,
          avatar_url: avatarUrl,
        })
      }

      onSaved()
      onClose()
    } catch (err) {
      logger.error('[EditWorldClubModal] Save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save club')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const hasProvinces = provinces.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isCreating ? 'Add New Club' : 'Edit Club'}
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

          {/* Club Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Club Logo
            </label>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="relative w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0 border border-gray-200">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Club logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Shield className="w-7 h-7 text-gray-400" />
                )}
                {isUploading && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {avatarUrl ? 'Replace' : 'Upload'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={isUploading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )}
                <p className="text-xs text-gray-500">JPG or PNG, max 5MB</p>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Upload club logo"
              />
            </div>
          </div>

          {/* Club Name */}
          <div>
            <label htmlFor="club-name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Club Name <span className="text-red-500">*</span>
            </label>
            <input
              id="club-name"
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Enter club name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            />
            {!isCreating && (
              <p className="mt-1 text-xs text-gray-500">
                Club ID: {club?.club_id} (read-only)
              </p>
            )}
          </div>

          {/* Country */}
          <div>
            <label htmlFor="club-country" className="block text-sm font-medium text-gray-700 mb-1.5">
              Country <span className="text-red-500">*</span>
            </label>
            <select
              id="club-country"
              value={countryId ?? ''}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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

          {/* Region (if country has regions) */}
          {countryId && (
            <div>
              <label htmlFor="club-region" className="block text-sm font-medium text-gray-700 mb-1.5">
                Region {hasProvinces && <span className="text-gray-400">(optional)</span>}
              </label>
              {loadingProvinces ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading regions...
                </div>
              ) : hasProvinces ? (
                <select
                  id="club-region"
                  value={provinceId ?? ''}
                  onChange={(e) => handleProvinceChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">No region / National</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-500 py-2">
                  This country doesn't have regions
                </p>
              )}
            </div>
          )}

          {/* Leagues */}
          {countryId && (
            <>
              {/* Women's League */}
              <div>
                <label htmlFor="club-women-league" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Women's League <span className="text-gray-400">(optional)</span>
                </label>
                {loadingLeagues ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading leagues...
                  </div>
                ) : leagues.length > 0 ? (
                  <select
                    id="club-women-league"
                    value={womenLeagueId ?? ''}
                    onChange={(e) => setWomenLeagueId(e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="">None / Not applicable</option>
                    {leagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} {l.tier ? `(Tier ${l.tier})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-gray-500 py-2">
                    No leagues available for this location
                  </p>
                )}
              </div>

              {/* Men's League */}
              <div>
                <label htmlFor="club-men-league" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Men's League <span className="text-gray-400">(optional)</span>
                </label>
                {loadingLeagues ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading leagues...
                  </div>
                ) : leagues.length > 0 ? (
                  <select
                    id="club-men-league"
                    value={menLeagueId ?? ''}
                    onChange={(e) => setMenLeagueId(e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="">None / Not applicable</option>
                    {leagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} {l.tier ? `(Tier ${l.tier})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-gray-500 py-2">
                    No leagues available for this location
                  </p>
                )}
              </div>
            </>
          )}

          {/* Read-only info for existing clubs */}
          {!isCreating && club && (
            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-1">
                <strong>Created:</strong> {formatAdminDate(club.created_at)} ({club.created_from})
              </p>
              <p className="text-xs text-gray-500">
                <strong>Last Updated:</strong> {formatAdminDate(club.updated_at)}
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
                  {isCreating ? 'Add Club' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
