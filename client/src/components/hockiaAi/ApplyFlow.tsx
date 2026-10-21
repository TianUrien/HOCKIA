import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '@/lib/auth'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { submitApplication } from '@/lib/submitApplication'
import { recordAiAction } from '@/lib/aiChats'
import { AVAILABILITY_LABELS, loadApplyDraft, type ApplyDraft } from '@/lib/applyDraft'
import { positionLabel } from '@/lib/identity'
import { hapticSuccess } from '@/lib/haptics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { cn } from '@/lib/utils'
import { MascotAvatar } from './mascot'
import type { ApplyTarget } from './hockiaAiSheetStore'

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

export function ApplyFlow({ target, onFindSimilar, onAddVideo, onClose }: { target: ApplyTarget; onFindSimilar: (q: string) => void; onAddVideo: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const { countries } = useCountries()
  const [phase, setPhase] = useState<Phase>('loading')
  const [draft, setDraft] = useState<ApplyDraft | null>(null)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const org = target.organization ?? 'the club'

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
  const eligibility = useMemo(() => (vacancy ? checkOpportunityEligibility(vacancy, profile, countries) : null), [vacancy, profile, countries])
  const passports = useMemo(() => [profile?.nationality_country_id, profile?.nationality2_country_id]
    .map((id) => countries.find((c) => c.id === id)).filter(Boolean)
    .map((c) => `${c!.common_name || c!.name}${isEuCountryCode(c!.code) ? ' (EU)' : ''}`), [profile, countries])
  const available = (() => {
    const from = profile?.available_from ? new Date(profile.available_from) : null
    const when = from && !Number.isNaN(from.getTime()) ? format(from, 'MMMM yyyy') : null
    const duration = profile?.availability_duration ? AVAILABILITY_LABELS[profile.availability_duration] ?? null : null
    return [when ?? 'Now', duration].filter(Boolean).join(' · ')
  })()
  const contact = profile?.contact_email ? 'Email' : 'Shown once the club replies'
  const roleLine = [vacancy ? positionLabel(vacancy.position) ?? vacancy.title : target.title, org].filter(Boolean).join(' · ')

  const send = async () => {
    if (!vacancy || !user || phase === 'sending' || !eligibility?.eligible) return
    setPhase('sending'); setError(null)
    const res = await submitApplication(vacancy, user.id, note, { viewerRole: profile?.role ?? null, source: 'hockia_ai', via: 'hockia_ai' })
    if (!res.ok) { setError(res.message); setPhase('draft'); return }
    trackDbEvent('hockia_ai_apply_sent', 'vacancy', vacancy.id, { note_by_ai: draft?.kind === 'draft' && draft.byAi && note === draft.note })
    void hapticSuccess()
    setPhase(res.already ? 'already' : 'sent')
    // Chats (handoff C2): "Applied to Holcombe · Action · Application sent".
    if (!res.already) void recordAiAction({ kind: 'apply', title: `Applied to ${org}`, summary: 'Action · Application sent', link: `/opportunities/${vacancy.id}` })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-testid="apply-flow">
      <div className="flex flex-col gap-4 pb-6 pt-1">
        <div className="flex justify-end"><p className="max-w-[300px] rounded-[20px] rounded-br-[6px] bg-hockia-primary px-3.5 py-2.5 text-[16px] leading-[22px] text-white">Apply to {org} for me</p></div>

        {phase === 'loading' && (
          <Turn><p className="flex items-center gap-2 text-secondary font-semibold text-brand-primary" data-testid="apply-drafting"><Loader2 className="h-4 w-4 animate-spin" /> Drafting your application…</p></Turn>
        )}

        {phase === 'closed' && <Turn><p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-closed">This role isn’t taking applications any more.</p></Turn>}
        {phase === 'error' && <Turn><p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-error">Oops, I lost the signal for a second. Close this and try again in a moment.</p></Turn>}
        {phase === 'already' && (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1" data-testid="apply-already">You’ve applied to {org}{draft?.kind === 'already' && draft.appliedAt ? ` on ${format(new Date(draft.appliedAt), 'd MMM')}` : ''}. You can follow it in Applied.</p>
            <button type="button" onClick={() => { onClose(); navigate('/opportunities/applications') }} className="mt-2 text-secondary font-semibold text-brand-primary">Open Applied</button>
          </Turn>
        )}

        {(phase === 'draft' || phase === 'sending') && vacancy && (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1">{eligibility?.eligible ? 'Done drafting. Check it and send when you’re happy. Nothing goes out until you tap Send.' : 'I checked this role first:'}</p>
            {eligibility && !eligibility.eligible ? (
              <div className="mt-2.5 rounded-[16px] bg-surface-muted px-3.5 py-3 text-[14px] leading-[19px] text-ink-2" data-testid="apply-not-eligible">
                {(eligibility.reason ?? 'This role is for another team category.').replace(/\.$/, '')}, so this role can’t take your application. You can still message the club.
              </div>
            ) : (
              <div className="mt-2.5 overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_6px_18px_rgba(74,31,148,0.08)]" data-testid="apply-draft-card">
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <EntityAvatar src={target.logoUrl} name={org} role="club" size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-micro font-semibold uppercase tracking-[0.04em] text-brand-primary">Application · Draft</p>
                    <p className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{roleLine}</p>
                  </div>
                </div>
                {[['Available from', available], ['Passport', passports.join(' · ') || 'Not given'], ['Contact', contact]].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-t-[0.5px] border-line px-3.5 py-2.5 text-[14px]">
                    <span className="text-ink-2">{k}</span><span className="truncate text-right font-semibold text-ink-1">{v}</span>
                  </div>
                ))}
                <div className="border-t-[0.5px] border-line px-3.5 py-3">
                  <p className="text-micro font-semibold uppercase tracking-[0.04em] text-ink-3">{draft?.kind === 'draft' && draft.byAi && note === draft.note ? 'Note to the club · written by Hockia AI' : 'Note to the club'}</p>
                  {editing ? (
                    <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 600))} rows={5} autoFocus aria-label="Note to the club" className="mt-1.5 w-full resize-none rounded-[12px] border border-line p-2.5 text-[15px] leading-[21px] text-ink-1 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30" data-testid="apply-note-input" />
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-[21px] text-ink-1" data-testid="apply-note">{note || 'No note. Your profile is the application.'}</p>
                  )}
                </div>
                {error && <p className="px-3.5 pb-1 text-secondary text-status-danger" role="alert">{error}</p>}
                <div className="flex gap-2 px-3.5 pb-3.5 pt-1">
                  <button type="button" onClick={() => setEditing((v) => !v)} className="flex h-12 flex-1 items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-ink-1" data-testid="apply-edit">{editing ? 'Done' : 'Edit'}</button>
                  <button type="button" onClick={() => void send()} disabled={phase === 'sending'} className="flex h-12 flex-[1.6] items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="apply-send">{phase === 'sending' ? 'Sending…' : 'Send application'}</button>
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
                <span className="block text-[14px] font-semibold text-ink-1">Application sent to {org}</span>
                <button type="button" onClick={() => { onClose(); navigate('/opportunities/applications') }} className="text-secondary font-semibold text-positive">Follow it in Applied</button>
              </span>
            </div>
            <p className="mt-2.5 text-[16px] leading-[22px] text-ink-1">{profile?.highlight_video_url ? 'Nice one. Want me to look for similar roles while they review it?' : 'Nice one. While they review it, want to add a highlights video? Clubs can watch you play before they reply.'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!profile?.highlight_video_url && <button type="button" onClick={onAddVideo} className="h-9 rounded-full border border-line px-3.5 text-secondary font-semibold text-ink-1" data-testid="apply-chip-video">Add a highlights video</button>}
              <button type="button" onClick={() => onFindSimilar(`Find roles like ${roleLine}`)} className="h-9 rounded-full border border-line px-3.5 text-secondary font-semibold text-ink-1" data-testid="apply-chip-similar">Find similar roles</button>
            </div>
          </Turn>
        )}
      </div>
    </div>
  )
}
