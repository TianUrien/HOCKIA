import { usePressSpring } from '@/hooks/usePressSpring'
import { cn } from '@/lib/utils'

/**
 * Hockia AI · header button (Figma 178:25): 44 pt hit, the mascot head in a
 * soft ring. `hasSuggestion` = the active head + a brand dot — only when
 * Hockia AI has something real and new for this user, never a fake nudge
 * (nothing sets it yet).
 */
export function HockiaAiButton({ onClick, hasSuggestion = false, className }: { onClick: () => void; hasSuggestion?: boolean; className?: string }) {
  const press = usePressSpring<HTMLButtonElement>()
  const state = hasSuggestion ? 'active' : 'calm'
  return (
    <button
      ref={press.ref}
      type="button"
      onClick={onClick}
      {...press.handlers}
      aria-label={hasSuggestion ? 'Hockia AI, something new for you' : 'Ask Hockia AI'}
      className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full [transform-origin:center]', className)}
      data-testid="hockia-ai-button"
    >
      <span className="absolute inset-[3px] rounded-full" style={{ boxShadow: hasSuggestion ? '0 0 0 2px rgba(167,139,250,0.55), 0 0 12px rgba(167,139,250,0.6)' : '0 0 0 1.5px rgba(167,139,250,0.35)' }} aria-hidden="true" />
      <img
        src={`/hockia-ai/button_${state}_96.webp`}
        srcSet={`/hockia-ai/button_${state}_96.webp 1x, /hockia-ai/button_${state}_192.webp 2x, /hockia-ai/button_${state}_288.webp 3x`}
        alt=""
        width={36}
        height={36}
        className="relative h-9 w-9 rounded-full"
        draggable={false}
      />
      {hasSuggestion && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand-primary" aria-hidden="true" />}
    </button>
  )
}
