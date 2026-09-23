import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { humanizeToken } from '@/lib/identity'

/**
 * Write a reference (Figma 152:962 — the sheet over the profile). Only for
 * friends, and it says so: the relationship first, then the words; the
 * player approves before publication. The backend has request / respond only,
 * so this sheet answers a request the member sent: the relationship is the
 * one they chose (shown, not editable), the text is yours, Send accepts.
 */
interface WriteReferenceSheetProps {
  open: boolean
  onClose: () => void
  /** First name of the member you are vouching for. */
  forName: string | null
  relationshipType: string
  requestNote?: string | null
  loading: boolean
  onSend: (endorsement: string) => Promise<boolean>
  onDecline?: () => Promise<boolean> | void
}

const MAX = 800

export default function WriteReferenceSheet({ open, onClose, forName, relationshipType, requestNote, loading, onSend, onDecline }: WriteReferenceSheetProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setText(''); setError(null) } }, [open])
  const who = forName ?? 'this member'
  const remaining = MAX - text.length

  const send = async () => {
    const value = text.trim()
    if (value.length < 20) { setError('A few sentences, please — clubs read these.'); return }
    const ok = await onSend(value)
    if (!ok) setError('Could not send that. Please try again.')
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!loading) onClose() }} ariaLabel={`Write a reference for ${who}`}>
      <div className="px-5 pb-3 pt-1">
        <h2 className="text-[22px] font-bold leading-[27px] text-ink-1">Write a reference for {who}</h2>
        <p className="mt-2 flex items-start gap-1.5 text-secondary leading-[18px] text-ink-2">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.5} />
          <span>You can write one because you’re friends. {who} reviews it before it goes public.</span>
        </p>

        <p className="mt-4 text-row font-semibold text-ink-1">How you know {who}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="flex h-9 items-center rounded-full bg-ink-1 px-3.5 text-[14px] font-semibold text-white">{humanizeToken(relationshipType)}</span>
        </div>
        {requestNote?.trim() && <p className="mt-2 text-secondary text-ink-2">“{requestNote.trim()}”</p>}

        <div className="relative mt-4">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, MAX)); setError(null) }}
            rows={5}
            aria-label="Your reference"
            placeholder={`What did ${who} bring to the team? Be specific — clubs read these.`}
            className="w-full resize-none rounded-[14px] bg-surface-grouped p-3.5 text-body leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
          />
          {remaining <= 50 && <span className="pointer-events-none absolute bottom-2.5 right-3 text-caption text-ink-4">{remaining}</span>}
        </div>
        {error && <p role="alert" className="mt-2 text-secondary text-red-600">{error}</p>}

        <button type="button" onClick={() => void send()} disabled={loading} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60">
          {loading ? 'Sending…' : 'Send reference'}
        </button>
        {onDecline && (
          <button type="button" onClick={() => void onDecline()} disabled={loading} className="mt-1 flex h-11 w-full items-center justify-center text-row font-semibold text-ink-2 disabled:opacity-60">
            Decline
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
