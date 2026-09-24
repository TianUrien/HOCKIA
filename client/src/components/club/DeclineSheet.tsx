import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { DECLINE_REASON_CHIPS } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'

/**
 * Decline sheet (Figma 04 Club · Decline 326:528; DEV NOTE 327:576). The
 * club picks one of the nine reason codes; Hockia AI drafts a kind note in
 * the club's voice (application-feedback, mode 'draft'), regenerated when
 * the reason changes until the club edits it. "Decline and send" hands
 * the reason + the note (as written) back to the review screen, which holds
 * the decision for the Undo window before it is sent.
 */
interface DeclineSheetProps {
  open: boolean
  applicationId: string
  firstName: string
  pronoun: 'him' | 'her' | 'them'
  onCancel: () => void
  onSend: (reason: string, message: string) => void
}

const MAX = 600

export function DeclineSheet({ open, applicationId, firstName, pronoun, onCancel, onSend }: DeclineSheetProps) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [edited, setEdited] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    if (!open) { setReason(null); setNote(''); setEdited(false) }
  }, [open])

  useEffect(() => {
    if (!open || !reason || edited) return
    const req = ++reqRef.current
    setDrafting(true)
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('application-feedback', { body: { mode: 'draft', application_id: applicationId, reason } })
        if (req !== reqRef.current) return
        if (error) throw error
        const msg = (data as { message?: string } | null)?.message ?? ''
        setNote(msg)
      } catch (err) {
        logger.warn('[DeclineSheet] draft failed', err)
      } finally {
        if (req === reqRef.current) setDrafting(false)
      }
    })()
  }, [open, reason, edited, applicationId])

  const canSend = Boolean(reason) && note.trim().length > 0 && note.length <= MAX && !drafting
  const pronounPossessive = pronoun === 'him' ? 'his' : pronoun === 'her' ? 'her' : 'their'
  const subject = pronoun === 'him' ? 'He’ll' : pronoun === 'her' ? 'She’ll' : 'They’ll'

  return (
    <BottomSheet open={open} onClose={onCancel} ariaLabel={`Decline ${firstName}`}>
      <div className="flex flex-col gap-3.5 px-5 pb-6 pt-1" data-testid="decline-sheet">
        <div className="pt-1">
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.11px] text-ink-1">Decline {firstName}?</h2>
          <p className="mt-1 text-[14px] leading-5 text-ink-2">Pick a reason. Hockia writes {pronoun} a kind note from it — change anything before it goes.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
          {DECLINE_REASON_CHIPS.map((r) => (
            <button
              key={r.code}
              type="button"
              role="radio"
              aria-checked={reason === r.code}
              onClick={() => { setReason(r.code); if (!edited) setNote('') }}
              className={cn('rounded-full px-3.5 py-2 text-[14px] font-semibold', reason === r.code ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1')}
            >
              {r.label}
            </button>
          ))}
        </div>
        {reason && (
          <div className="flex flex-col gap-2 rounded-card bg-surface-grouped p-3.5">
            <span className="flex items-center gap-1.5 text-caption font-semibold text-hockia-primary">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} /> {drafting ? 'Drafting with Hockia AI…' : edited ? 'Your note' : 'Drafted by Hockia AI · tap to edit'}
            </span>
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setEdited(true) }}
              rows={Math.max(4, Math.ceil(note.length / 40))}
              maxLength={MAX}
              aria-label={`Note to ${firstName}`}
              placeholder={drafting ? '' : `Write a short note to ${firstName}`}
              className="w-full resize-none bg-transparent text-[15px] leading-[21px] text-ink-1 outline-none placeholder:text-ink-4"
            />
          </div>
        )}
        <p className="text-caption text-ink-4">{subject} see this note on {pronounPossessive} application and in the email about it.</p>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => reason && onSend(reason, note.trim())}
          className="flex h-[50px] w-full items-center justify-center rounded-full bg-[#e5484d] text-body font-semibold text-white disabled:opacity-40"
        >
          Decline and send
        </button>
        <button type="button" onClick={onCancel} className="py-1 text-body font-semibold text-hockia-primary">Cancel</button>
      </div>
    </BottomSheet>
  )
}
