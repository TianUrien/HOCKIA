import { cn } from '@/lib/utils'

/**
 * The one circle for a full-screen wait (founder report 2026-11-23: two
 * different spinners showed one after the other on a reload, a thin arc and
 * a thick ring). Every full-screen loader draws this thin violet arc, so a
 * chain of waits reads as one. Buttons and inline waits keep Loader2.
 */
export function PageSpinner({ className }: { className?: string }) {
  return <div className={cn('h-12 w-12 animate-spin rounded-full border-b-2 border-hockia-primary', className)} data-testid="page-spinner" aria-hidden="true" />
}
