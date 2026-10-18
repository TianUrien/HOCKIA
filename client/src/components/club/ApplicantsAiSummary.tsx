import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MascotAvatar } from '@/components/hockiaAi/mascot'
import type { Applicant } from '@/hooks/useRoleApplicants'
import { cachedSummary, summariseApplicants } from '@/lib/applicantsSummary'
import { trackDbEvent } from '@/lib/trackDbEvent'

/**
 * Hockia AI · summary of the applicants to review (handoff C3, Figma 180:397),
 * for the role's publisher. Facts only, Beta (ruling 2026-10-18). Runs on
 * "Summarise" (one Hockia AI question) and is kept for the day.
 */
export function ApplicantsAiSummary({ roleId, pending, expiryDays, className }: { roleId: string; pending: Applicant[]; expiryDays: number; className?: string }) {
  const [text, setText] = useState<string | null>(() => cachedSummary(roleId, pending))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const ids = pending.map((a) => a.applicationId).sort().join(',')
  // A different set of applicants (a decision, a new one) → the old summary no longer fits.
  useEffect(() => { setText(cachedSummary(roleId, pending)); setNote(null) }, [roleId, ids]) // eslint-disable-line react-hooks/exhaustive-deps

  if (pending.length < 2) return null
  const run = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    const res = await summariseApplicants(roleId, pending, expiryDays)
    trackDbEvent('hockia_ai_applicants_summary', 'vacancy', roleId, { applicants: pending.length, ok: res.ok })
    if (res.ok) setText(res.text)
    else setNote(res.reason === 'cap' ? 'You’ve reached today’s Hockia AI limit. Everything else works as usual.' : 'I couldn’t summarise right now. Try again in a moment.')
    setBusy(false)
  }
  return (
    <div className={className ?? 'rounded-[16px] border border-brand-primary/25 bg-brand-soft p-3.5'} data-testid="applicants-ai-summary">
      <div className="flex items-start gap-2.5">
        <MascotAvatar size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold uppercase tracking-[0.04em] text-brand-primary">Hockia AI · Summary · Beta</p>
          {text ? (
            <p className="mt-1 text-[15px] leading-[21px] text-ink-1" data-testid="applicants-ai-summary-text">{text}</p>
          ) : (
            <>
              <p className="mt-1 text-[15px] leading-[21px] text-ink-1">I can sum up the {pending.length} applicants to review from what their profiles show.</p>
              <button type="button" onClick={() => void run()} disabled={busy} className="mt-2 flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-secondary font-semibold text-brand-primary disabled:opacity-60" data-testid="applicants-ai-summarise">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busy ? 'Summarising…' : 'Summarise'}
              </button>
            </>
          )}
          {note && <p className="mt-1.5 text-caption text-ink-2">{note}</p>}
        </div>
      </div>
    </div>
  )
}
