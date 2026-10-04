import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

interface UpdatePromptProps {
  /** Applies the waiting service worker; the page reloads once it controls. */
  onReload: () => void
  /** Called after the prompt is dismissed (it stays hidden for this page). */
  onDismiss?: () => void
}

/**
 * "A new version of HOCKIA is ready" (onboarding QA 2026-10-04). Small neutral
 * banner at the top; the page never reloads on its own — only the Reload tap
 * applies the update (lib/swUpdate.ts). Dismiss hides it for this page; the
 * next load shows it again while the new version is still waiting.
 */
export default function UpdatePrompt({ onReload, onDismiss }: UpdatePromptProps) {
  const [hidden, setHidden] = useState(false)
  const [reloading, setReloading] = useState(false)
  if (hidden) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[14px] bg-white py-2 pl-3.5 pr-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-inset ring-line"
      >
        <RefreshCw className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-row font-medium text-ink-1">A new version of HOCKIA is ready</p>
        <Button
          variant="tonal"
          size="small"
          loading={reloading}
          onClick={() => {
            setReloading(true)
            onReload()
          }}
        >
          Reload
        </Button>
        <IconButton
          label="Dismiss"
          onClick={() => {
            setHidden(true)
            onDismiss?.()
          }}
        >
          <X className="h-4 w-4 text-ink-3" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}
