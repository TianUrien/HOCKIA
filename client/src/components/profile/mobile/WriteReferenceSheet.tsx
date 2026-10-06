import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Chip } from '@/components/ui/Chip'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { humanizeToken } from '@/lib/identity'

/**
 * Write a reference (Figma 152:962 — the sheet over the profile). Only for
 * friends, and it says so: the relationship first, then the words; the
 * player approves before publication. The backend has request / respond only,
 * so this sheet answers a request the member sent: the relationship is the
 * one they chose (shown as the selected Chip, not editable), the text is yours,
 * Send accepts. Copy is gender-neutral: the member's first name, never a pronoun.
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
        <h2 className="text-title text-ink-1">Write a reference for {who}</h2>
        <p className="mt-2 flex items-start gap-1.5 text-secondary leading-[18px] text-ink-2">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" strokeWidth={2.5} aria-hidden="true" />
          <span>You can write one because you’re friends. {who} reviews it before it goes public.</span>
        </p>

        <p className="mt-4 text-row font-semibold text-ink-1" data-testid="write-reference-question">How do you know {who}?</p>
        {/* Relationship = Chips, wrapping. The requester chose it (request / respond
            backend), so the one chip shows selected and does not toggle. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip label={humanizeToken(relationshipType) ?? relationshipType} selected aria-disabled="true" tabIndex={-1} className="pointer-events-none" data-testid="write-reference-relationship" />
        </div>
        {requestNote?.trim() && <p className="mt-2 text-secondary text-ink-2">“{requestNote.trim()}”</p>}

        <div className="relative mt-4">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, MAX)); setError(null) }}
            rows={5}
            aria-label="Your reference"
            placeholder={`What did ${who} bring to the team? Be specific — clubs read these.`}
            className="w-full resize-none rounded-[12px] bg-surface-muted p-3.5 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-hockia-primary"
          />
          {remaining <= 50 && <span className="pointer-events-none absolute bottom-2.5 right-3 text-caption text-ink-3">{remaining}</span>}
        </div>
        {error && <p role="alert" className="mt-2 text-secondary text-red-600">{error}</p>}

        <button type="button" onClick={() => void send()} disabled={loading} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-4' })} data-testid="write-reference-send">
          {loading ? 'Sending…' : 'Send reference'}
        </button>
        {onDecline && (
          <button type="button" onClick={() => void onDecline()} disabled={loading} className={buttonClassName({ variant: 'tertiary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-1' })}>
            Decline
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
