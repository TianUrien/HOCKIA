export default function Footer() {
  const currentYear = new Date().getFullYear()

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
            © {currentYear} HOCKIA
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center">
            <a
              href="/privacy-policy"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label="Privacy Policy"
            >
              Privacy Policy
            </a>

            <span className="text-gray-400 dark:text-gray-600" aria-hidden="true">•</span>

            <a
              href="/terms"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label="Terms of Service"
            >
              Terms
            </a>

            <span className="text-gray-400 dark:text-gray-600" aria-hidden="true">•</span>

            <a
              href="/developers"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label="Developer documentation and API"
            >
              For Developers
            </a>

            <span className="text-gray-400 dark:text-gray-600" aria-hidden="true">•</span>

            <a
              href="mailto:team@inhockia.com"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors underline-offset-4 hover:underline"
              aria-label="Contact support via email"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
