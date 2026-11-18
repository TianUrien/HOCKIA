import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { AuthStatus } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { SearchIcon } from '@/components/icons/HockiaIcons'
import { useTranslation } from 'react-i18next'

/** Not found (rebrand page 28 · System): what happened, two ways on. */
export default function NotFoundPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { t } = useTranslation()
  useDocumentTitle(t('notFound.documentTitle'))

  return (
    <div className="flex min-h-app-screen flex-col bg-white px-6 pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AuthStatus
          tone="brand"
          icon={<SearchIcon className="h-9 w-9" />}
          title={t('notFound.title')}
          actions={
            <>
              <Button block onClick={() => navigate(user ? '/home' : '/')}>{t('notFound.goHome')}</Button>
              <Button block variant="secondary" onClick={() => navigate('/search')}>{t('notFound.search')}</Button>
            </>
          }
        >
          {t('notFound.body')}
        </AuthStatus>
      </main>
    </div>
  )
}
