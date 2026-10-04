import type { ReactNode } from 'react'
import { Award, Check, UserPlus } from 'lucide-react'
import { EntityAvatar } from './EntityAvatar'
import { buttonClassName } from './buttonClasses'
import type { RoleLike } from '@/lib/identity'

/**
 * List item / Friend (Figma "03 · Components" 555:4870): avatar 52, name,
 * "role · position · flags" on one line (the text truncates, the flags never
 * do) and an optional GOLD "Wrote a reference" pill — trust is gold, never
 * green or amber. The trailing slot is one of:
 *   ask       Tonal Small "Ask for reference" (own list)
 *   requested grey pill with a check (a request is out)
 *   friends   grey pill with a check (public list)
 *   add       Tonal Small with user-plus (public list; label "Add"/"Accept")
 *   wrote     "Wrote you a reference" in gold text (own list)
 *   none      nothing
 */
export type FriendTrailing =
  | { kind: 'ask'; onClick: () => void; disabled?: boolean }
  | { kind: 'requested' }
  | { kind: 'friends' }
  | { kind: 'add'; onClick: () => void; disabled?: boolean; label?: string }
  | { kind: 'wrote' }
  | { kind: 'none' }

interface FriendListItemProps {
  name: string
  avatarUrl: string | null
  role?: RoleLike
  /** "Player · Forward" — truncates. */
  meta: string
  /** Passport flags — never truncate. */
  flags?: string | null
  /** Gold "Wrote a reference" pill under the meta line. */
  showReference?: boolean
  trailing: FriendTrailing
  onOpen?: () => void
}

const GREY_PILL = 'flex h-9 shrink-0 items-center gap-1 rounded-full bg-surface-grouped px-3 text-secondary font-semibold text-ink-2'
const TONAL_SMALL = buttonClassName({ variant: 'tonal', size: 'small', radius: 'rounded-full' })

function Trailing({ trailing, name }: { trailing: FriendTrailing; name: string }): ReactNode {
  switch (trailing.kind) {
    case 'ask':
      return <button type="button" onClick={trailing.onClick} disabled={trailing.disabled} className={TONAL_SMALL} data-testid="friend-trailing-ask">Ask for reference</button>
    case 'requested':
      return <span className={GREY_PILL} data-testid="friend-trailing-requested"><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> Requested</span>
    case 'friends':
      return <span className={GREY_PILL} data-testid="friend-trailing-friends"><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> Friends</span>
    case 'add':
      return (
        <button type="button" onClick={trailing.onClick} disabled={trailing.disabled} aria-label={`${trailing.label ?? 'Add'} ${name}`} className={TONAL_SMALL} data-testid="friend-trailing-add">
          <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> {trailing.label ?? 'Add'}
        </button>
      )
    case 'wrote':
      return <span className="max-w-[45%] shrink-0 text-right text-secondary font-semibold text-gold" data-testid="friend-trailing-wrote">Wrote you a reference</span>
    default:
      return null
  }
}

export function FriendListItem({ name, avatarUrl, role, meta, flags, showReference = false, trailing, onOpen }: FriendListItemProps) {
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-b-0" data-testid="friend-list-item">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <EntityAvatar src={avatarUrl} name={name} role={role} size={52} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-semibold text-ink-1">{name}</span>
          <span className="flex min-w-0 items-center text-secondary text-ink-2">
            <span className="min-w-0 truncate">{meta}</span>
            {flags && <span className="shrink-0 whitespace-pre"> · {flags}</span>}
          </span>
          {showReference && (
            <span className="mt-1 inline-flex h-[22px] items-center gap-1 rounded-full bg-gold-soft px-2 text-caption font-semibold text-gold" data-testid="friend-reference-pill">
              <Award className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" /> Wrote a reference
            </span>
          )}
        </span>
      </button>
      <Trailing trailing={trailing} name={name} />
    </li>
  )
}
