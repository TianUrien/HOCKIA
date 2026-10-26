import { AuthStatus } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'

/** Offline (rebrand page 28 · System): what still works, one way back. */
export default function OfflinePage() {
  return (
    <div className="flex min-h-app-screen flex-col bg-white px-6 pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AuthStatus
          tone="brand"
          icon={<OfflineGlyph />}
          title="You’re offline"
          actions={<Button block onClick={() => window.location.reload()}>Try again</Button>}
        >
          You can still read what’s loaded. Send messages or applications when you’re back online.
        </AuthStatus>
      </main>
    </div>
  )
}

function OfflineGlyph() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.86a10 10 0 0 1 5.17-2.7" /><path d="M19 12.86a10 10 0 0 0-2.01-1.52" /><path d="M2 8.82a15 15 0 0 1 4.17-2.65" /><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" /><path d="M12 20h.01" />
    </svg>
  )
}
