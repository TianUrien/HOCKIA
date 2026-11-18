import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '@/lib/auth'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { applyRoleMismatch } from '@/lib/applyRoleMatch'
import { submitApplication } from '@/lib/submitApplication'
import { recordAiAction } from '@/lib/aiChats'
import { AVAILABILITY_LABELS, loadApplyDraft, type ApplyDraft } from '@/lib/applyDraft'
import { positionLabel } from '@/lib/identity'
import { hapticSuccess } from '@/lib/haptics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { cn } from '@/lib/utils'
import { MascotAvatar } from './mascot'
import type { ApplyTarget } from './hockiaAiSheetStore'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'
import { getDateFnsLocale } from '@/i18n/format'
import { dayFirst } from '@/lib/dayFirst'
import { countryLabel } from '@/i18n/countryNames'

/**
 * "Prepare my application" (handoff A4 175:222 → A5 175:313). Hockia AI
 * drafts the note from the member's own facts; the card shows what the club
 * will see; nothing is sent until "Send application" (ruling 2026-10-18:
 * Hockia AI drafts, the member edits). Same eligibility rules and the same
 * write as the Apply sheet.
 */
type Phase = 'loading' | 'draft' | 'sending' | 'sent' | 'already' | 'closed' | 'error'

function Turn({ children, glow = false }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-2', glow ? 'border-[#a88cfa] shadow-[0_0_6px_rgba(168,140,250,0.7)]' : 'border-[rgba(168,140,250,0.5)]')}>
        <MascotAvatar size={36} />
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  )
}

export function ApplyFlow({ target, onFindSimilar, onAddVideo, onClose }: { target: ApplyTarget; onFindSimilar: (q: string, shown?: string) => void; onAddVideo: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const { countries } = useCountries()
  const [phase, setPhase] = useState<Phase>('loading')
  const [draft, setDraft] = useState<ApplyDraft | null>(null)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useHockiaAiT()
  // No organisation on the target: every line has its own "the club" wording.
  const org = target.organization ?? null

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void loadApplyDraft(target.id).then((d) => {
      if (cancelled) return
      setDraft(d)
      if (d.kind === 'draft') { setNote(d.note); setPhase('draft') } else setPhase(d.kind)
    })
    return () => { cancelled = true }
  }, [target.id])

  const vacancy = draft?.kind === 'draft' ? draft.vacancy : null
  const eligibility = useMemo(() => {
    if (!vacancy) return null
    // Search results don't carry the role type: a player role offered to a coach stops here, not at the server.
    const mismatch = applyRoleMismatch(vacancy.opportunity_type, profile?.role)
    return mismatch ? { eligible: false, reason: mismatch } : checkOpportunityEligibility(vacancy, profile, countries)
  }, [vacancy, profile, countries])
  const passports = useMemo(() => [profile?.nationality_country_id, profile?.nationality2_country_id]
    .map((id) => countries.find((c) => c.id === id)).filter(Boolean)
    .map((c) => (isEuCountryCode(c!.code) ? t('apply.euSuffix', { country: countryLabel(c!.common_name || c!.name) }) : countryLabel(c!.common_name || c!.name))), [profile, countries, t])
  const available = (() => {
    const from = profile?.available_from ? new Date(profile.available_from) : null
    const when = from && !Number.isNaN(from.getTime()) ? format(from, 'MMMM yyyy', { locale: getDateFnsLocale() }) : null
    const duration = profile?.availability_duration ? AVAILABILITY_LABELS[profile.availability_duration] ?? null : null
    return [when ?? t('apply.now'), duration].filter(Boolean).join(' · ')
  })()
  const contact = profile?.contact_email ? t('apply.contactEmail') : t('apply.contactHidden')
  const roleLine = [vacancy ? positionLabel(vacancy.position) ?? vacancy.title : target.title, org ?? t('apply.theClub')].filter(Boolean).join(' · ')
  const appliedOn = draft?.kind === 'already' && draft.appliedAt ? dayFirst(draft.appliedAt, { year: 'never' }) : null
  const alreadyLine = appliedOn
    ? (org ? t('apply.alreadyOn', { org, date: appliedOn }) : t('apply.alreadyOnNoOrg', { date: appliedOn }))
    : (org ? t('apply.already', { org }) : t('apply.alreadyNoOrg'))

  const send = async () => {
    if (!vacancy || !user || phase === 'sending' || !eligibility?.eligible) return
    setPhase('sending'); setError(null)
    const res = await submitApplication(vacancy, user.id, note, { viewerRole: profile?.role ?? null, source: 'hockia_ai', via: 'hockia_ai' })
    if (!res.ok) { setError(res.message); setPhase('draft'); return }
    trackDbEvent('hockia_ai_apply_sent', 'vacancy', vacancy.id, { note_by_ai: draft?.kind === 'draft' && draft.byAi && note === draft.note })
    void hapticSuccess()
    setPhase(res.already ? 'already' : 'sent')
    // Chats (handoff C2): "Applied to Holcombe · Action · Application sent". Stored in English (stored values stay English).
    if (!res.already) void recordAiAction({ kind: 'apply', title: org ? t('apply.chatTitle', { org, lng: 'en' }) : t('apply.chatTitleNoOrg', { lng: 'en' }), summary: t('apply.chatSummary', { lng: 'en' }), link: `/opportunities/${vacancy.id}` })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-testid="apply-flow">
      <div className="flex flex-col gap-4 pb-6 pt-1">
        <div className="flex justify-end"><p className="max-w-[300px] rounded-[20px] rounded-br-[6px] bg-hockia-primary px-3.5 py-2.5 text-[16px] leading-[22px] text-white">{org ? t('apply.userBubble', { org }) : t('apply.userBubbleNoOrg')}</p></div>

        {phase === 'loading' && (
          <Turn><p className="flex items-center gap-2 text-secondary font-semibold text-brand-primary" data-testid="apply-drafting"><Loader2 className="h-4 w-4 animate-spin" /> {t('apply.drafting')}</p></Turn>
        )}

        {phase === 'closed' && <Turn><p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-closed">{t('apply.closed')}</p></Turn>}
        {phase === 'error' && <Turn><p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-error">{t('apply.error')}</p></Turn>}
        {phase === 'already' && (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-already">{alreadyLine}</p>
            <button type="button" onClick={() => { onClose(); navigate('/opportunities/applications') }} className="mt-2 text-secondary font-semibold text-brand-primary">{t('apply.openApplied')}</button>
          </Turn>
        )}

        {(phase === 'draft' || phase === 'sending') && vacancy && (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1">{eligibility?.eligible ? t('apply.draftReady') : t('apply.checkedFirst')}</p>
            {eligibility && !eligibility.eligible ? (
              <div className="mt-2.5 rounded-[16px] bg-surface-muted px-3.5 py-3 text-[14px] leading-[19px] text-ink-2" data-testid="apply-not-eligible">
                {t('apply.notEligible', { reason: (eligibility.reason ?? t('apply.defaultReason')).replace(/\.$/, '') })}
              </div>
            ) : (
              <div className="mt-2.5 overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_6px_18px_rgba(74,31,148,0.08)]" data-testid="apply-draft-card">
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <EntityAvatar src={target.logoUrl} name={org ?? t('apply.theClub')} role="club" size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-micro font-semibold uppercase tracking-[0.04em] text-brand-primary">{t('apply.cardEyebrow')}</p>
                    <p className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{roleLine}</p>
                  </div>
                </div>
                {[[t('apply.availableFrom'), available], [t('apply.passport'), passports.join(' · ') || t('apply.notGiven')], [t('apply.contact'), contact]].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-t-[0.5px] border-line px-3.5 py-2.5 text-[14px]">
                    <span className="text-ink-2">{k}</span><span className="truncate text-right font-semibold text-ink-1">{v}</span>
                  </div>
                ))}
                <div className="border-t-[0.5px] border-line px-3.5 py-3">
                  <p className="text-micro font-semibold uppercase tracking-[0.04em] text-ink-3">{draft?.kind === 'draft' && draft.byAi && note === draft.note ? t('apply.noteByAi') : t('apply.note')}</p>
                  {editing ? (
                    <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 600))} rows={5} autoFocus aria-label={t('apply.note')} className="mt-1.5 w-full resize-none rounded-[12px] border border-line p-2.5 text-[15px] leading-[21px] text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30" data-testid="apply-note-input" />
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-[21px] text-ink-1" data-testid="apply-note">{note || t('apply.noNote')}</p>
                  )}
                </div>
                {error && <p className="px-3.5 pb-1 text-secondary text-status-danger" role="alert">{error}</p>}
                <div className="flex gap-2 px-3.5 pb-3.5 pt-1">
                  <button type="button" onClick={() => setEditing((v) => !v)} className="flex h-12 flex-1 items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-ink-1" data-testid="apply-edit">{editing ? t('apply.done') : t('apply.edit')}</button>
                  <button type="button" onClick={() => void send()} disabled={phase === 'sending'} className="flex h-12 flex-[1.6] items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="apply-send">{phase === 'sending' ? t('apply.sending') : t('apply.send')}</button>
                </div>
              </div>
            )}
          </Turn>
        )}

        {phase === 'sent' && (
          <Turn glow>
            <div className="flex items-center gap-2.5 rounded-[18px] bg-positive-soft p-3" data-testid="apply-sent">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-positive text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink-1">{org ? t('apply.sent', { org }) : t('apply.sentNoOrg')}</span>
                <button type="button" onClick={() => { onClose(); navigate('/opportunities/applications') }} className="text-secondary font-semibold text-positive">{t('apply.followApplied')}</button>
              </span>
            </div>
            <p className="mt-2.5 text-[16px] leading-[22px] text-ink-1">{profile?.highlight_video_url ? t('apply.afterSimilar') : t('apply.afterVideo')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!profile?.highlight_video_url && <button type="button" onClick={onAddVideo} className="h-9 rounded-full border border-line px-3.5 text-secondary font-semibold text-ink-1" data-testid="apply-chip-video">{t('apply.addVideo')}</button>}
              <button type="button" onClick={() => onFindSimilar(t('apply.findSimilarQuery', { role: roleLine, lng: 'en' }), t('apply.findSimilarQuery', { role: roleLine }))} className="h-9 rounded-full border border-line px-3.5 text-secondary font-semibold text-ink-1" data-testid="apply-chip-similar">{t('apply.findSimilar')}</button>
            </div>
          </Turn>
        )}
      </div>
    </div>
  )
}
