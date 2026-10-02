import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { closeRoleNote, markSignedBody } from '@/lib/signing'
import { cn } from '@/lib/utils'

/**
 * D4.4 · Mark as signed (Figma 390:647; DEV NOTE 391:36). After the player
 * accepts (or straight after shortlist when the club never used offers).
 * Sets signed_pending_confirmation and asks the player to confirm. Close the
 * role is on by default: on the player's confirm the role closes and everyone
 * still waiting gets the kind "role filled" note. Off → the role stays open
 * (clubs signing several players).
 */
interface Props {
  open: boolean
  firstName: string
  playerAvatar: string | null
  playerName: string | null
  clubAvatar: string | null
  clubName: string | null
  publisherIsClub: boolean
  roleLabel: string
  waiting: number
  busy: boolean
  onClose: () => void
  onConfirm: (closeRole: boolean) => void
}

export default function MarkSignedSheet({ open, firstName, playerAvatar, playerName, clubAvatar, clubName, publisherIsClub, roleLabel, waiting, busy, onClose, onConfirm }: Props) {
  const [closeRole, setCloseRole] = useState(true)
  useEffect(() => { if (open) setCloseRole(true) }, [open])

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`Mark ${firstName} as signed`}>
      <div className="px-5 pb-2 pt-2 text-center" data-testid="mark-signed-sheet">
        <div className="flex justify-center">
          <span className="rounded-full ring-2 ring-white"><EntityAvatar src={clubAvatar} name={clubName} role="club" size={56} /></span>
          <span className="-ml-3 rounded-full ring-2 ring-white"><EntityAvatar src={playerAvatar} name={playerName} role="player" size={56} /></span>
        </div>
        <h2 className="mt-3 text-[22px] font-bold leading-7 tracking-[-0.2px] text-ink-1">Mark {firstName} as signed?</h2>
        <p className="mt-2 text-[15px] leading-[21px] text-ink-2">{markSignedBody(firstName, publisherIsClub)}</p>

        <button
          type="button"
          role="checkbox"
          aria-checked={closeRole}
          onClick={() => setCloseRole((v) => !v)}
          className="mt-4 flex w-full items-start gap-3 rounded-2xl bg-surface-grouped px-3.5 py-3 text-left"
          data-testid="close-role-toggle"
        >
          <span className={cn('mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]', closeRole ? 'bg-hockia-primary text-white' : 'border-[1.5px] border-ink-4 bg-white')} aria-hidden="true">
            {closeRole && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-5 text-ink-1">Close {roleLabel}</span>
            <span className="block text-secondary leading-[18px] text-ink-2">{closeRole ? closeRoleNote(waiting) : 'The role stays open, for signing more players.'}</span>
          </span>
        </button>

        <button type="button" onClick={() => onConfirm(closeRole)} disabled={busy} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="mark-signed-confirm">
          {busy ? 'Saving…' : 'Mark as signed'}
        </button>
        <button type="button" onClick={onClose} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1">
          Not yet
        </button>
      </div>
    </BottomSheet>
  )
}
