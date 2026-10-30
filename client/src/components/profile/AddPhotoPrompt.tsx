import RolePlaceholder from '@/components/RolePlaceholder'
import { CloseIcon } from '@/components/icons/HockiaIcons'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { isRoleAvatarRole } from '@/lib/roleAvatar'
import { cn } from '@/lib/utils'

interface AddPhotoPromptProps {
  /** The owner's role: picks the placeholder (Player when unknown). */
  role: string | null | undefined
  onAdd: () => void
  /** Dismissible, never blocking: hides the prompt. */
  onDismiss?: () => void
  busy?: boolean
  /** Another violet Primary owns the screen: Add becomes Tonal. */
  secondary?: boolean
  className?: string
}

/**
 * Figma Assets "Prompt / Add photo" (founder 2026-10-26): shown only to the
 * owner while they have no photo, next to the Avatar / Placeholder that
 * stands in for it. Home next step, own profile header, end of onboarding.
 */
export function AddPhotoPrompt({ role, onAdd, onDismiss, busy = false, secondary = false, className }: AddPhotoPromptProps) {
  return (
    <div className={cn('flex items-center gap-3.5 rounded-[20px] bg-white py-3.5 pl-4 pr-2 shadow-[0_6px_10px_rgba(15,10,36,0.08)] ring-1 ring-inset ring-line', className)} data-testid="add-photo-prompt">
      <span className="block h-[52px] w-[52px] shrink-0 overflow-hidden rounded-full">
        <RolePlaceholder role={isRoleAvatarRole(role) ? role : 'player'} label="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-[1.3] text-ink-1">Add a photo</span>
        <span className="mt-0.5 block text-[13px] leading-[1.4] text-ink-2">So clubs and players know it’s you.</span>
      </span>
      <button type="button" onClick={onAdd} disabled={busy} className={buttonClassName({ variant: secondary ? 'tonal' : 'primary', size: 'large', radius: 'rounded-full', className: 'shrink-0 px-5' })} data-testid="add-photo-prompt-add">
        {busy ? 'Uploading…' : 'Add'}
      </button>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Not now" className="-ml-1.5 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink-2" data-testid="add-photo-prompt-dismiss">
          <CloseIcon className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  )
}
