/**
 * ShortlistDetailPage — P1.5 (Spec G.8).
 *
 * Rows: avatar, HockeyContextLine, ClubFitChip, status pill (4-way
 * Unsorted / Top pick / Maybe / Not a fit), inline note (auto-save),
 * Open profile + Remove actions. Empty state explains how to add
 * players to the list.
 *
 * RLS gates everything on owner_id = auth.uid().
 */

import { shortlistDisplayName } from '@/lib/shortlistName'
import { useEffect, useState } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookmarkCheck, Star, Trash2, ExternalLink, FolderInput } from 'lucide-react'
import Header from '@/components/Header'
import { Avatar, RoleBadge } from '@/components'
import ClubFitChip from '@/components/recruiting/ClubFitChip'
import HockeyContextLine from '@/components/recruiting/HockeyContextLine'
import MoveToShortlistMenu from '@/components/recruiting/MoveToShortlistMenu'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { getInitials } from '@/lib/utils'
import {
  useShortlistItems,
  type ShortlistItemStatus,
  type ShortlistItemSummary,
} from '@/hooks/useShortlists'
import { useRecruitingT } from '@/i18n/ns/recruiting'

const STATUS_OPTIONS = [
  { value: 'unsorted', labelKey: 'shortlistDetail.statusUnsorted' },
  { value: 'good_fit', labelKey: 'shortlistDetail.statusTopPick' },
  { value: 'maybe', labelKey: 'shortlistDetail.statusMaybe' },
  { value: 'not_a_fit', labelKey: 'shortlistDetail.statusNotAFit' },
] as const satisfies readonly { value: ShortlistItemStatus; labelKey: string }[]

export default function ShortlistDetailPage() {
  const t = useRecruitingT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [listName, setListName] = useState<string | null>(null)
  const [isDefault, setIsDefault] = useState(false)

  useDocumentTitle(listName ?? t('shortlistDetail.documentTitle'))

  const { items, loading, error, setStatus, setNote, remove, moveTo } = useShortlistItems(id ?? null)

  // Fetch the list's name + default flag once. RLS scopes to owner.
  useEffect(() => {
    if (!id || !user) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('shortlists')
        .select('name, is_default')
        .eq('id', id)
        .single()
      if (cancelled) return
      setListName(data ? shortlistDisplayName(data) : null)
      setIsDefault(Boolean(data?.is_default))
    })()
    return () => { cancelled = true }
  }, [id, user])

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 pt-under-header-lg pb-12 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('shortlistDetail.signedOutTitle')}</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-3xl mx-auto px-4 pt-under-header pb-12">
        <Link
          to="/dashboard/shortlists"
          className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-1"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('shortlistDetail.allShortlists')}
        </Link>

        <header className="mb-6">
          <h1 className="flex flex-wrap items-center gap-2 text-title text-ink-1">
            {listName ?? t('shortlistDetail.titleFallback')}
            {isDefault && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-hockia-soft px-2 py-0.5 font-sans text-caption font-semibold text-brand-text">
                <Star className="w-3 h-3 fill-current" />
                {t('shortlistDetail.defaultBadge')}
              </span>
            )}
          </h1>
          <p className="mt-2 text-[17px] leading-[22px] text-ink-2">
            {t('shortlistDetail.countLine', { count: items.length })}
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <ShortlistItemRow
                key={item.id}
                item={item}
                currentShortlistId={id ?? null}
                onStatusChange={(s) => void setStatus(item.id, s)}
                onNoteSave={(note) => void setNote(item.id, note)}
                onRemove={() => void remove(item.id)}
                onMoveTo={(target, name) => moveTo(item.id, target, name)}
                onOpen={() => navigate(`/players/id/${item.profile?.id ?? item.saved_profile_id}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  item: ShortlistItemSummary
  currentShortlistId: string | null
  onStatusChange: (s: ShortlistItemStatus) => void
  onNoteSave: (note: string | null) => void
  onRemove: () => void
  onMoveTo: (targetShortlistId: string, targetName: string) => Promise<void>
  onOpen: () => void
}

function ShortlistItemRow({
  item, currentShortlistId, onStatusChange, onNoteSave, onRemove, onMoveTo, onOpen,
}: RowProps) {
  const t = useRecruitingT()
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)

  // Debounced auto-save on blur (kept simple — onBlur is sufficient
  // for short notes and matches the spec's "inline textarea, auto-save"
  // requirement without thrashing the DB on every keystroke).
  const commitNote = () => {
    const trimmed = noteDraft.trim()
    const next = trimmed.length === 0 ? null : trimmed
    if (next === (item.note ?? null)) return
    setSavingNote(true)
    onNoteSave(next)
    // The hook updates optimistically + reverts on failure; we don't
    // need to wait. Brief savingNote flag for visual feedback.
    setTimeout(() => setSavingNote(false), 400)
  }

  if (!item.profile) {
    // Player profile was deleted but the saved_profiles row hadn't
    // cascaded yet (rare). Render a minimal "missing" row so the
    // user can remove it.
    return (
      <li className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 italic flex items-center justify-between">
        <span>{t('shortlistDetail.unavailable')}</span>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-status-danger-soft hover:text-status-danger"
          aria-label={t('shortlistDetail.remove')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </li>
    )
  }

  const p = item.profile

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start gap-3">
        <Avatar
          src={p.avatar_url}
          alt={p.full_name ?? t('shortlistDetail.playerFallback')}
          initials={getInitials(p.full_name)}
          role="player"
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={onOpen}
              className="text-sm font-semibold text-gray-900 hover:text-hockia-primary truncate text-left"
            >
              {p.full_name}
            </button>
            <RoleBadge role={p.role} />
            <ClubFitChip
              candidate={{
                id: p.id,
                role: p.role,
                playing_category: p.playing_category,
                current_world_club_id: p.current_world_club_id,
                competition_level_band: null,
                open_to_play: p.open_to_play,
                open_to_coach: p.open_to_coach,
                open_to_opportunities: p.open_to_opportunities,
                last_active_at: p.last_active_at,
              }}
              variant="badge"
            />
          </div>
          <HockeyContextLine
            clubName={p.current_club}
            competitionName={null}
            position={p.position}
            className="mb-2"
          />

          {/* Status (rebrand: Chip / Selectable — soft violet when chosen, 44 pt
              tall; status words carry the meaning, no red or green fills). */}
          <div role="radiogroup" aria-label={t('shortlistDetail.statusLabel')} className="mb-2 flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={t(opt.labelKey)}
                selected={item.status === opt.value}
                role="radio"
                aria-checked={item.status === opt.value}
                aria-pressed={undefined}
                onClick={() => onStatusChange(opt.value)}
                className="px-3 text-[13px]"
              />
            ))}
          </div>

          {/* Inline note */}
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            rows={2}
            placeholder={t('shortlistDetail.notePlaceholder')}
            className="w-full text-xs px-2.5 py-2 border border-gray-200 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary/30 focus:border-hockia-primary focus:outline-none resize-none"
          />
          {savingNote && (
            <p className="text-[10px] text-gray-400 mt-0.5">{t('shortlistDetail.saving')}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0 relative">
          <button
            type="button"
            onClick={onOpen}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-hockia-soft hover:text-hockia-primary"
            aria-label={t('shortlistDetail.openProfile')}
            title={t('shortlistDetail.openProfile')}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMoveMenuOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-hockia-soft hover:text-hockia-primary"
            aria-label={t('shortlistDetail.moveLabel')}
            title={t('shortlistDetail.moveTo')}
          >
            <FolderInput className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-status-danger-soft hover:text-status-danger"
            aria-label={t('shortlistDetail.removeFromList')}
            title={t('shortlistDetail.remove')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <MoveToShortlistMenu
            open={moveMenuOpen}
            onClose={() => setMoveMenuOpen(false)}
            onPick={(target, name) => onMoveTo(target, name)}
            currentShortlistId={currentShortlistId}
            title={t('shortlistDetail.moveTo')}
          />
        </div>
      </div>
    </li>
  )
}

function EmptyState() {
  const t = useRecruitingT()
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
      <BookmarkCheck className="w-10 h-10 text-gray-400 mx-auto mb-3" />
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('shortlistDetail.emptyTitle')}</h2>
      <p className="text-sm text-gray-600 mb-4">
        {t('shortlistDetail.emptyBody')}
      </p>
      <Link
        to="/community"
        className="inline-flex items-center px-4 py-2 rounded-lg bg-hockia-primary text-white text-sm font-semibold hover:bg-[#6b1de0]"
      >
        {t('shortlistDetail.browseCommunity')}
      </Link>
    </div>
  )
}
