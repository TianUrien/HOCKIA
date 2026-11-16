import { Link } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useProfileT } from '@/i18n/ns/profile'

/**
 * Anon-only footer CTA shown at the bottom of public profile pages.
 *
 * Renders nothing if the viewer is logged in — the footer is meant to
 * convert external visitors who arrived from a WhatsApp/email/LinkedIn
 * share, not to nag existing users on their own profile.
 */
export default function PublicProfileFooterCTA() {
  const user = useAuthStore((s) => s.user)
  const t = useProfileT()
  if (user) return null

  return (
    <div
      data-testid="public-profile-footer-cta"
      className="mx-auto mt-10 max-w-3xl px-4 pb-10 md:pb-14"
    >
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm md:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-hockia-primary">
          {t('publicProfileFooterCTA.eyebrow')}
        </p>
        <h2 className="mt-2 text-lg font-bold text-gray-900 md:text-xl">
          {t('publicProfileFooterCTA.title')}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          {t('publicProfileFooterCTA.body')}
        </p>
        <Link
          to="/signup"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-hockia-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-[#6B20D4]"
        >
          {t('publicProfileFooterCTA.signUp')}
        </Link>
      </div>
    </div>
  )
}
