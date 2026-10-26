import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { AuthStatus } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { SearchIcon } from '@/components/icons/HockiaIcons'

/** Not found (rebrand page 28 · System): what happened, two ways on. */
export default function NotFoundPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  useDocumentTitle('Page not found')

  return (
    <div className="flex min-h-app-screen flex-col bg-white px-6 pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AuthStatus
          tone="brand"
          icon={<SearchIcon className="h-9 w-9" />}
          title="We can’t find that page"
          actions={
            <>
              <Button block onClick={() => navigate(user ? '/home' : '/')}>Go to Home</Button>
              <Button block variant="secondary" onClick={() => navigate('/search')}>Search Hockia</Button>
            </>
          }
        >
          The link may be old, or the page was removed.
        </AuthStatus>
      </main>
    </div>
  )
}
