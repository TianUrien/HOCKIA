import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/lib/auth'
import { applyResolvedLanguage, currentLanguage, storedLanguage } from '@/i18n'
import { DEFAULT_LANGUAGE } from './languages'
import { chooseLanguage, saveLanguageOnAccount } from './saveLanguage'

/**
 * Keeps the interface language in step with the signed-in member's saved
 * choice (profiles.ui_language) and remounts the app when the language
 * changes, so copy produced outside React hooks (lib helpers, memoized
 * labels) is rebuilt in the new language. The URL is kept, so the member
 * stays on the same screen.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const profileChoice = useAuthStore((state) => (state.profile as { ui_language?: string | null } | null)?.ui_language ?? null)

  const signedIn = useAuthStore((state) => Boolean(state.profile))

  useEffect(() => {
    if (profileChoice) { void applyResolvedLanguage(profileChoice); return }
    // Chosen on this device before signing in: copy it to the profile.
    const stored = storedLanguage()
    if (!signedIn) return
    if (stored) { void chooseLanguage(stored); return }
    // No choice anywhere and the device put the app in another language:
    // save it, so emails and pushes match what the member reads. English
    // needs no write (NULL already reads as English on the server).
    const detected = currentLanguage()
    if (detected !== DEFAULT_LANGUAGE) void saveLanguageOnAccount(detected)
  }, [profileChoice, signedIn])

  return <div key={i18n.language} className="contents">{children}</div>
}
