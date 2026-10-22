import { cn } from '@/lib/utils'

/**
 * The Hockia AI "Beta" label (copy rule: Hockia AI is labelled Beta
 * everywhere). `onSoft` is for entries that already sit on brand/soft, where
 * the soft pill would disappear: it turns white with brand text.
 */
export function BetaPill({ onSoft = false, testId = 'hockia-ai-beta' }: { onSoft?: boolean; testId?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-caption font-semibold text-brand-primary', onSoft ? 'bg-white' : 'bg-brand-soft')}
      data-testid={testId}
    >
      Beta
    </span>
  )
}
