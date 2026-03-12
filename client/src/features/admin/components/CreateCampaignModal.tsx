import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Users, Loader2, Megaphone } from 'lucide-react'
import type { EmailTemplate, WorldCountry, OutreachAudiencePreview } from '../types'
import { getAllCountries, createEmailCampaign } from '../api/adminApi'
import { previewOutreachAudience } from '../api/outreachApi'
import { useAudiencePreview } from '../hooks/useEmailStats'
import { logger } from '@/lib/logger'

interface CreateCampaignModalProps {
  templates: EmailTemplate[]
  onClose: () => void
  onCreated: () => void
}

export function CreateCampaignModal({ templates, onClose, onCreated }: CreateCampaignModalProps) {
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [category, setCategory] = useState('notification')
  const [audienceSource, setAudienceSource] = useState<'users' | 'outreach'>('users')
  const [filterRoles, setFilterRoles] = useState<string[]>([])
  const [filterCountry, setFilterCountry] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Users audience preview
  const { preview: usersPreview, isLoading: usersPreviewLoading, error: usersPreviewError, fetchPreview: fetchUsersPreview, reset: resetUsersPreview } = useAudiencePreview()

  // Outreach audience preview
  const [outreachPreview, setOutreachPreview] = useState<OutreachAudiencePreview | null>(null)
  const [outreachPreviewLoading, setOutreachPreviewLoading] = useState(false)
  const [outreachPreviewError, setOutreachPreviewError] = useState<string | null>(null)

  const isOutreach = audienceSource === 'outreach'

  // Filter templates by audience source
  const activeTemplates = templates.filter(t => {
    if (!t.is_active) return false
    if (isOutreach) return t.category === 'marketing'
    return true
  })

  useEffect(() => {
    getAllCountries().then(setCountries).catch((err) => {
      logger.warn('[CreateCampaignModal] Failed to load countries for filter', err)
    })
  }, [])

  // Reset filters when audience source changes
  useEffect(() => {
    setFilterRoles([])
    setFilterCountry('')
    setFilterStatus('')
    setTemplateId('')
    resetUsersPreview()
    setOutreachPreview(null)
    setOutreachPreviewError(null)
    if (isOutreach) {
      setCategory('marketing')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceSource])

  const audienceFilter = useMemo(() => ({
    ...(filterRoles.length > 0 ? { roles: filterRoles } : {}),
    ...(filterCountry ? { country: filterCountry } : {}),
    ...(filterStatus ? { status: filterStatus } : {}),
  }), [filterRoles, filterCountry, filterStatus])

  const handlePreview = useCallback(async () => {
    if (isOutreach) {
      setOutreachPreviewLoading(true)
      setOutreachPreviewError(null)
      try {
        const result = await previewOutreachAudience({
          ...(filterCountry ? { country: filterCountry } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
        })
        setOutreachPreview(result)
      } catch (err) {
        setOutreachPreviewError(err instanceof Error ? err.message : 'Failed to preview')
        setOutreachPreview(null)
      } finally {
        setOutreachPreviewLoading(false)
      }
    } else {
      fetchUsersPreview(category, audienceFilter)
    }
  }, [isOutreach, filterCountry, filterStatus, category, audienceFilter, fetchUsersPreview])

  const toggleRole = useCallback((role: string) => {
    setFilterRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }, [])

  const handleCreate = async () => {
    if (!name.trim() || !templateId) return
    setCreating(true)
    setError(null)
    try {
      await createEmailCampaign({
        name: name.trim(),
        template_id: templateId,
        category,
        audience_filter: audienceFilter,
        audience_source: audienceSource,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  // Reset preview when filters change
  useEffect(() => {
    resetUsersPreview()
    setOutreachPreview(null)
    setOutreachPreviewError(null)
  }, [filterRoles, filterCountry, filterStatus, category, resetUsersPreview])

  const previewLoading = isOutreach ? outreachPreviewLoading : usersPreviewLoading
  const previewError = isOutreach ? outreachPreviewError : usersPreviewError
  const preview = isOutreach ? outreachPreview : usersPreview

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create Campaign</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Audience Source Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Audience</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setAudienceSource('users')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                  !isOutreach
                    ? 'bg-purple-50 text-purple-700 border-r border-purple-200'
                    : 'bg-white text-gray-500 hover:bg-gray-50 border-r border-gray-200'
                }`}
              >
                <Users className="w-4 h-4" />
                Platform Users
              </button>
              <button
                type="button"
                onClick={() => setAudienceSource('outreach')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                  isOutreach
                    ? 'bg-purple-50 text-purple-700'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                <Megaphone className="w-4 h-4" />
                Outreach Contacts
              </button>
            </div>
          </div>

          {/* Campaign name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isOutreach ? 'e.g. Italy Club Introduction' : 'e.g. February Player Newsletter'}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">Select a template...</option>
              {activeTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Category — hidden for outreach (always marketing) */}
          {!isOutreach && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Category"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="notification">Notification</option>
                <option value="marketing">Marketing</option>
              </select>
            </div>
          )}

          {/* Audience filters */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Audience Filters</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Role filter — only for users */}
              {!isOutreach && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-2">Roles {filterRoles.length === 0 && <span className="text-gray-400">(all)</span>}</label>
                  <div className="flex flex-wrap gap-2">
                    {(['player', 'coach', 'club', 'brand'] as const).map((role) => {
                      const checked = filterRoles.includes(role)
                      const styles: Record<string, { active: string; inactive: string }> = {
                        player: { active: 'bg-blue-50 border-blue-300 text-blue-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        coach: { active: 'bg-teal-50 border-teal-300 text-teal-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        club: { active: 'bg-orange-50 border-orange-300 text-orange-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        brand: { active: 'bg-rose-50 border-rose-300 text-rose-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                      }
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => toggleRole(role)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                            checked ? styles[role].active : styles[role].inactive
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                            checked ? 'bg-current border-current' : 'border-gray-300'
                          }`}>
                            {checked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </span>
                          <span className="capitalize">{role}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Status filter — only for outreach */}
              {isOutreach && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    aria-label="Status"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All statuses</option>
                    <option value="imported">Imported</option>
                    <option value="contacted">Contacted</option>
                    <option value="delivered">Delivered</option>
                    <option value="opened">Opened</option>
                  </select>
                </div>
              )}

              {/* Country filter */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Country</label>
                {isOutreach ? (
                  <input
                    type="text"
                    placeholder="e.g. Italy"
                    value={filterCountry}
                    onChange={(e) => setFilterCountry(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                ) : (
                  <select
                    value={filterCountry}
                    onChange={(e) => setFilterCountry(e.target.value)}
                    aria-label="Country"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All countries</option>
                    {countries.map(c => (
                      <option key={c.id} value={c.code}>{c.flag_emoji} {c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Preview audience button */}
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewLoading}
              className="mt-3 flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
            >
              {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Preview Audience
            </button>

            {previewError && (
              <p className="mt-2 text-xs text-red-600">{previewError}</p>
            )}

            {/* Preview results */}
            {preview && (
              <div className="mt-3 bg-gray-50 rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-900 mb-2">
                  {preview.count.toLocaleString()} recipient{preview.count !== 1 ? 's' : ''} match
                </p>
                {preview.sample.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 mb-1">Sample:</p>
                    {preview.sample.map((s: Record<string, unknown>, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 truncate max-w-[180px]">
                          {isOutreach
                            ? (s.club_name as string) || (s.email as string)
                            : (s.full_name as string) || (s.email as string)
                          }
                        </span>
                        <div className="flex items-center gap-2">
                          {isOutreach
                            ? <span className="text-gray-500">{(s.status as string) || ''}</span>
                            : <span className="text-gray-500 capitalize">{(s.role as string) || ''}</span>
                          }
                          {(s.country_name || s.country) && (
                            <span className="text-gray-400">{(s.country_name || s.country) as string}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {preview.count > 10 && (
                      <p className="text-xs text-gray-400 mt-1">...and {(preview.count - 10).toLocaleString()} more</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !templateId || creating}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Draft Campaign
          </button>
        </div>
      </div>
    </div>
  )
}
