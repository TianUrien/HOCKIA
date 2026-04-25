import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Users, Loader2, Megaphone, Search, CheckSquare, Square, MinusSquare } from 'lucide-react'
import type { EmailTemplate, EmailCampaign, WorldCountry, OutreachContact } from '../types'
import { getAllCountries, createEmailCampaign, updateEmailCampaign } from '../api/adminApi'
import { getAllOutreachContacts } from '../api/outreachApi'
import { useAudiencePreview } from '../hooks/useEmailStats'
import { logger } from '@/lib/logger'

interface CreateCampaignModalProps {
  templates: EmailTemplate[]
  editCampaign?: EmailCampaign | null
  onClose: () => void
  onCreated: () => void
}

const STATUS_COLORS: Record<string, string> = {
  imported: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-50 text-blue-700',
  delivered: 'bg-green-50 text-green-700',
  opened: 'bg-amber-50 text-amber-700',
  clicked: 'bg-purple-50 text-purple-700',
}

export function CreateCampaignModal({ templates, editCampaign, onClose, onCreated }: CreateCampaignModalProps) {
  const isEditing = !!editCampaign
  const [name, setName] = useState(editCampaign?.name ?? '')
  const [templateId, setTemplateId] = useState(editCampaign?.template_id ?? '')
  const [category, setCategory] = useState(editCampaign?.category ?? 'notification')
  const [audienceSource, setAudienceSource] = useState<'users' | 'outreach'>(
    (editCampaign?.audience_source as 'users' | 'outreach') ?? 'users'
  )
  const [filterRoles, setFilterRoles] = useState<string[]>(
    () => {
      const af = editCampaign?.audience_filter as Record<string, unknown> | null
      if (af?.roles && Array.isArray(af.roles)) return af.roles as string[]
      if (af?.role && typeof af.role === 'string') return [af.role]
      return []
    }
  )
  const [filterCountry, setFilterCountry] = useState(
    () => {
      const af = editCampaign?.audience_filter as Record<string, unknown> | null
      return (af?.country as string) ?? ''
    }
  )
  const [filterStatus, setFilterStatus] = useState(
    () => {
      const af = editCampaign?.audience_filter as Record<string, unknown> | null
      return (af?.status as string) ?? ''
    }
  )
  const [filterClub, setFilterClub] = useState(
    () => {
      const af = editCampaign?.audience_filter as Record<string, unknown> | null
      return (af?.club as string) ?? ''
    }
  )
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Outreach contact picker state
  const [allContacts, setAllContacts] = useState<OutreachContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    () => {
      const af = editCampaign?.audience_filter as Record<string, unknown> | null
      if (af?.contact_ids && Array.isArray(af.contact_ids)) return new Set(af.contact_ids as string[])
      return new Set<string>()
    }
  )
  const [contactSearch, setContactSearch] = useState('')

  // A/B testing state
  const [isAbTest, setIsAbTest] = useState(() => !!editCampaign?.ab_variants)
  const [variantASubject, setVariantASubject] = useState(() => editCampaign?.ab_variants?.A?.subject ?? '')
  const [variantBSubject, setVariantBSubject] = useState(() => editCampaign?.ab_variants?.B?.subject ?? '')
  const [variantATemplateId, setVariantATemplateId] = useState(() => editCampaign?.ab_variants?.A?.template_id ?? '')
  const [variantBTemplateId, setVariantBTemplateId] = useState(() => editCampaign?.ab_variants?.B?.template_id ?? '')

  // Users audience preview
  const { preview: usersPreview, isLoading: usersPreviewLoading, error: usersPreviewError, fetchPreview: fetchUsersPreview, reset: resetUsersPreview } = useAudiencePreview()

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

  // Load outreach contacts when switching to outreach mode
  useEffect(() => {
    if (isOutreach) {
      setContactsLoading(true)
      getAllOutreachContacts()
        .then(setAllContacts)
        .catch((err) => {
          logger.warn('[CreateCampaignModal] Failed to load outreach contacts', err)
        })
        .finally(() => setContactsLoading(false))
    }
  }, [isOutreach])

  // Reset filters when audience source changes
  useEffect(() => {
    setFilterRoles([])
    setFilterCountry('')
    setFilterStatus('')
    setFilterClub('')
    setTemplateId('')
    setContactSearch('')
    resetUsersPreview()
    if (!isEditing) {
      setSelectedContactIds(new Set())
    }
    if (isOutreach) {
      setCategory('marketing')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceSource])

  // Derive unique clubs and countries from contacts for dropdown filters
  const uniqueClubs = useMemo(() => {
    const clubs = new Set<string>()
    allContacts.forEach(c => { if (c.club_name) clubs.add(c.club_name) })
    return Array.from(clubs).sort()
  }, [allContacts])

  const uniqueCountries = useMemo(() => {
    const ctrs = new Set<string>()
    allContacts.forEach(c => { if (c.country) ctrs.add(c.country) })
    return Array.from(ctrs).sort()
  }, [allContacts])

  // Filter contacts client-side
  const filteredContacts = useMemo(() => {
    return allContacts.filter(c => {
      // Exclude bounced/unsubscribed/signed_up
      if (['bounced', 'unsubscribed', 'signed_up'].includes(c.status)) return false
      if (filterStatus && c.status !== filterStatus) return false
      if (filterClub && c.club_name !== filterClub) return false
      if (filterCountry && c.country !== filterCountry) return false
      if (contactSearch) {
        const q = contactSearch.toLowerCase()
        const matchesName = c.contact_name?.toLowerCase().includes(q)
        const matchesEmail = c.email.toLowerCase().includes(q)
        const matchesClub = c.club_name?.toLowerCase().includes(q)
        if (!matchesName && !matchesEmail && !matchesClub) return false
      }
      return true
    })
  }, [allContacts, filterStatus, filterClub, filterCountry, contactSearch])

  // Selection helpers
  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContactIds.has(c.id))
  const someFilteredSelected = filteredContacts.some(c => selectedContactIds.has(c.id))

  const toggleContact = useCallback((id: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAllFiltered = useCallback(() => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      filteredContacts.forEach(c => next.add(c.id))
      return next
    })
  }, [filteredContacts])

  const deselectAllFiltered = useCallback(() => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      filteredContacts.forEach(c => next.delete(c.id))
      return next
    })
  }, [filteredContacts])

  const toggleSelectAllFiltered = useCallback(() => {
    if (allFilteredSelected) {
      deselectAllFiltered()
    } else {
      selectAllFiltered()
    }
  }, [allFilteredSelected, selectAllFiltered, deselectAllFiltered])

  const clearSelection = useCallback(() => {
    setSelectedContactIds(new Set())
  }, [])

  // Build audience filter for save
  const audienceFilter = useMemo(() => {
    if (isOutreach) {
      return {
        ...(selectedContactIds.size > 0 ? { contact_ids: Array.from(selectedContactIds) } : {}),
        ...(filterClub ? { club: filterClub } : {}),
        ...(filterCountry ? { country: filterCountry } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      }
    }
    return {
      ...(filterRoles.length > 0 ? { roles: filterRoles } : {}),
      ...(filterCountry ? { country: filterCountry } : {}),
    }
  }, [isOutreach, selectedContactIds, filterClub, filterCountry, filterStatus, filterRoles])

  const toggleRole = useCallback((role: string) => {
    setFilterRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }, [])

  const handleSave = async () => {
    if (!name.trim()) return
    if (!templateId && !(isAbTest && (variantATemplateId || variantBTemplateId))) return
    if (isOutreach && selectedContactIds.size === 0) return
    setCreating(true)
    setError(null)
    try {
      // For A/B campaigns, use variant A's template as the base if main template is empty
      const effectiveTemplateId = templateId || variantATemplateId || variantBTemplateId

      const abVariants = isAbTest && variantASubject.trim() && variantBSubject.trim()
        ? {
            A: {
              subject: variantASubject.trim(),
              ...(variantATemplateId ? {
                template_id: variantATemplateId,
                template_key: activeTemplates.find(t => t.id === variantATemplateId)?.template_key,
              } : {}),
            },
            B: {
              subject: variantBSubject.trim(),
              ...(variantBTemplateId ? {
                template_id: variantBTemplateId,
                template_key: activeTemplates.find(t => t.id === variantBTemplateId)?.template_key,
              } : {}),
            },
          }
        : null

      if (isEditing && editCampaign) {
        await updateEmailCampaign({
          campaignId: editCampaign.id,
          name: name.trim(),
          template_id: effectiveTemplateId,
          category,
          audience_filter: audienceFilter,
          audience_source: audienceSource,
          ab_variants: abVariants,
        })
      } else {
        await createEmailCampaign({
          name: name.trim(),
          template_id: effectiveTemplateId,
          category,
          audience_filter: audienceFilter,
          audience_source: audienceSource,
          ab_variants: abVariants,
        })
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? 'Failed to update campaign' : 'Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  // Users preview
  const handleUsersPreview = useCallback(() => {
    fetchUsersPreview(category, audienceFilter)
  }, [category, audienceFilter, fetchUsersPreview])

  // Reset users preview when filters change
  useEffect(() => {
    resetUsersPreview()
  }, [filterRoles, filterCountry, category, resetUsersPreview])

  const hasTemplate = isAbTest
    ? (variantATemplateId || templateId) && (variantBTemplateId || templateId)
    : !!templateId
  const canSave = name.trim() && hasTemplate && (isOutreach ? selectedContactIds.size > 0 : true) && (!isAbTest || (variantASubject.trim() && variantBSubject.trim()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{isEditing ? 'Edit Campaign' : 'Create Campaign'}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
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

          {/* A/B Testing */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">A/B Test</label>
              <button
                type="button"
                onClick={() => setIsAbTest(!isAbTest)}
                aria-label="Toggle A/B testing"
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isAbTest ? 'bg-purple-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isAbTest ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
            </div>
            {isAbTest && (
              <div className="space-y-4 mt-3">
                <p className="text-xs text-gray-500">Recipients will be randomly split 50/50 between variants. Each variant can use a different template and subject.</p>

                {/* Variant A */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-700">Variant A</p>
                  <div>
                    <label className="block text-xs text-blue-600 mb-1">Template (optional override)</label>
                    <select
                      value={variantATemplateId}
                      onChange={(e) => setVariantATemplateId(e.target.value)}
                      aria-label="Variant A template"
                      className="w-full text-sm border border-blue-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">Same as campaign template</option>
                      {activeTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-blue-600 mb-1">Subject line</label>
                    <input
                      type="text"
                      value={variantASubject}
                      onChange={(e) => setVariantASubject(e.target.value)}
                      placeholder="e.g. Your club is already on HOCKIA"
                      className="w-full text-sm border border-blue-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {/* Variant B */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-700">Variant B</p>
                  <div>
                    <label className="block text-xs text-amber-600 mb-1">Template (optional override)</label>
                    <select
                      value={variantBTemplateId}
                      onChange={(e) => setVariantBTemplateId(e.target.value)}
                      aria-label="Variant B template"
                      className="w-full text-sm border border-amber-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="">Same as campaign template</option>
                      {activeTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-amber-600 mb-1">Subject line</label>
                    <input
                      type="text"
                      value={variantBSubject}
                      onChange={(e) => setVariantBSubject(e.target.value)}
                      placeholder="e.g. Join the hockey community on HOCKIA"
                      className="w-full text-sm border border-amber-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* OUTREACH: Contact Picker                                        */}
          {/* ================================================================ */}
          {isOutreach && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">Select Recipients</h3>
                {selectedContactIds.size > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700">
                    {selectedContactIds.size} selected
                  </span>
                )}
              </div>

              {/* Filters row */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <select
                    value={filterClub}
                    onChange={(e) => setFilterClub(e.target.value)}
                    aria-label="Club filter"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All clubs</option>
                    {uniqueClubs.map(club => (
                      <option key={club} value={club}>{club}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={filterCountry}
                    onChange={(e) => setFilterCountry(e.target.value)}
                    aria-label="Country filter"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All countries</option>
                    {uniqueCountries.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    aria-label="Status filter"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All statuses</option>
                    <option value="imported">Imported</option>
                    <option value="contacted">Contacted</option>
                    <option value="delivered">Delivered</option>
                    <option value="opened">Opened</option>
                    <option value="clicked">Clicked</option>
                  </select>
                </div>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, or club..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Select all bar */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-t-lg border border-gray-200 border-b-0">
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  className="flex items-center gap-2 text-xs font-medium text-gray-700 hover:text-gray-900"
                >
                  {allFilteredSelected ? (
                    <CheckSquare className="w-4 h-4 text-purple-600" />
                  ) : someFilteredSelected ? (
                    <MinusSquare className="w-4 h-4 text-purple-400" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                  {allFilteredSelected ? 'Deselect all' : `Select all (${filteredContacts.length})`}
                </button>
                <div className="flex items-center gap-3">
                  {selectedContactIds.size > 0 && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Clear selection
                    </button>
                  )}
                  <span className="text-xs text-gray-500">
                    {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Contact list */}
              <div className="border border-gray-200 rounded-b-lg max-h-[240px] overflow-y-auto">
                {contactsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    <span className="ml-2 text-sm text-gray-500">Loading contacts...</span>
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    {allContacts.length === 0 ? 'No outreach contacts yet' : 'No contacts match the filters'}
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white border-b border-gray-100">
                      <tr>
                        <th className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
                        <th className="text-left text-xs font-medium text-gray-500 px-2 py-2">Contact</th>
                        <th className="text-left text-xs font-medium text-gray-500 px-2 py-2">Club</th>
                        <th className="text-left text-xs font-medium text-gray-500 px-2 py-2">Country</th>
                        <th className="text-left text-xs font-medium text-gray-500 px-2 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContacts.map((contact) => {
                        const isSelected = selectedContactIds.has(contact.id)
                        return (
                          <tr
                            key={contact.id}
                            onClick={() => toggleContact(contact.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-purple-50 hover:bg-purple-100'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-3 py-2 text-center">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-purple-600 mx-auto" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 mx-auto" />
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <div>
                                <p className="text-xs font-medium text-gray-900 truncate max-w-[140px]">
                                  {contact.contact_name || contact.email}
                                </p>
                                {contact.contact_name && (
                                  <p className="text-[11px] text-gray-400 truncate max-w-[140px]">{contact.email}</p>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <span className="text-xs text-gray-700">{contact.club_name || '—'}</span>
                            </td>
                            <td className="px-2 py-2">
                              <span className="text-xs text-gray-600">{contact.country || '—'}</span>
                            </td>
                            <td className="px-2 py-2">
                              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
                                STATUS_COLORS[contact.status] || 'bg-gray-100 text-gray-600'
                              }`}>
                                {contact.status}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Selection summary */}
              {selectedContactIds.size > 0 && (
                <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg p-2.5">
                  <p className="text-xs font-medium text-purple-800">
                    Campaign will be sent to {selectedContactIds.size} recipient{selectedContactIds.size !== 1 ? 's' : ''}
                  </p>
                </div>
              )}

              {selectedContactIds.size === 0 && !contactsLoading && allContacts.length > 0 && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <p className="text-xs text-amber-700">Select at least one contact to create the campaign</p>
                </div>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* USERS: Filter-based audience                                     */}
          {/* ================================================================ */}
          {!isOutreach && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Audience Filters</h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Role filter */}
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-2">Roles {filterRoles.length === 0 && <span className="text-gray-400">(all)</span>}</label>
                  <div className="flex flex-wrap gap-2">
                    {(['player', 'coach', 'club', 'brand', 'umpire'] as const).map((role) => {
                      const checked = filterRoles.includes(role)
                      const styles: Record<string, { active: string; inactive: string }> = {
                        player: { active: 'bg-blue-50 border-blue-300 text-blue-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        coach: { active: 'bg-teal-50 border-teal-300 text-teal-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        club: { active: 'bg-orange-50 border-orange-300 text-orange-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        brand: { active: 'bg-rose-50 border-rose-300 text-rose-700', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
                        umpire: { active: 'bg-amber-50 border-amber-300 text-amber-800', inactive: 'bg-white border-gray-200 text-gray-600 hover:border-gray-300' },
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

                {/* Country filter */}
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
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
                </div>
              </div>

              {/* Preview audience button */}
              <button
                type="button"
                onClick={handleUsersPreview}
                disabled={usersPreviewLoading}
                className="mt-3 flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
              >
                {usersPreviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                Preview Audience
              </button>

              {usersPreviewError && (
                <p className="mt-2 text-xs text-red-600">{usersPreviewError}</p>
              )}

              {usersPreview && (
                <div className="mt-3 bg-gray-50 rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-medium text-gray-900 mb-2">
                    {usersPreview.count.toLocaleString()} recipient{usersPreview.count !== 1 ? 's' : ''} match
                  </p>
                  {usersPreview.sample.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500 mb-1">Sample:</p>
                      {usersPreview.sample.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 truncate max-w-[180px]">
                            {s.full_name || s.email}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 capitalize">{s.role || ''}</span>
                            {s.country_name && (
                              <span className="text-gray-400">{s.country_name}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {usersPreview.count > 10 && (
                        <p className="text-xs text-gray-400 mt-1">...and {(usersPreview.count - 10).toLocaleString()} more</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || creating}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Draft Campaign'}
          </button>
        </div>
      </div>
    </div>
  )
}
