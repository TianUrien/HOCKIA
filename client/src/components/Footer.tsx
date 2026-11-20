import HockiaSocials from './HockiaSocials'
import { useCommonT } from '@/i18n/ns/common'

export default function Footer() {
  const currentYear = new Date().getFullYear()
  const t = useCommonT()

  return (
    <footer
      role="contentinfo"
      className="w-full bg-white/80 backdrop-blur-md border-t border-gray-200/50 dark:bg-gray-900/80 dark:border-gray-700/50"
      style={{
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6 text-sm text-gray-600 dark:text-gray-400">
          {/* Copyright */}
          <div className="text-center sm:text-left">
            {t('footer.copyright', { year: currentYear })}
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center">
            <a
              href="/privacy-policy"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label={t('footer.privacy')}
            >
              {t('footer.privacy')}
            </a>

            <a
              href="/terms"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label={t('footer.termsLabel')}
            >
              {t('footer.terms')}
            </a>

            <a
              href="/developers"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label={t('footer.developersLabel')}
            >
              {t('footer.developers')}
            </a>

            <a
              href="mailto:team@inhockia.com"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label={t('footer.supportLabel')}
            >
              {t('footer.support')}
            </a>
          </div>

          {/* Follow us — official HOCKIA channels, kept out of the main nav. */}
          <HockiaSocials tone="muted" />
        </div>
      </div>
    </footer>
  )
}
