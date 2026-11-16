import { logger } from '@/lib/logger'
import { setLanguage } from '@/i18n'
import type { UiLanguage } from './languages'

/**
 * The member picked a language: switch now, remember it on this device, and
 * save it on the profile and the account when signed in so emails and
 * notifications can follow it. The profile write is best-effort: the interface has already
 * switched, and the device choice is copied up on a later sign-in.
 *
 * The auth store and the Supabase client are loaded here, not at the top:
 * the switch sits on the welcome screen, which must not pull in
 * `lib/supabase` (it throws at import without its env vars, as in the CI
 * unit job).
 */
export async function chooseLanguage(language: UiLanguage): Promise<void> {
  await setLanguage(language, { remember: true })
  const [{ useAuthStore }, { supabase }] = await Promise.all([import('@/lib/auth'), import('@/lib/supabase')])
  const { user, profile } = useAuthStore.getState()
  if (!user) return
  // The account's metadata too: the sign-in emails (confirm, reset password)
  // are rendered by Supabase Auth from it, not from the profile.
  if ((user.user_metadata as { ui_language?: string } | undefined)?.ui_language !== language) {
    const { error: metaError } = await supabase.auth.updateUser({ data: { ui_language: language } })
    if (metaError) logger.warn('[i18n] could not save the language on the account', metaError)
  }
  if (!profile) return
  if ((profile as { ui_language?: string | null }).ui_language === language) return
  const { error } = await supabase.from('profiles').update({ ui_language: language } as never).eq('id', user.id)
  if (error) {
    logger.warn('[i18n] could not save the language on the profile', error)
    return
  }
  useAuthStore.setState({ profile: { ...profile, ui_language: language } as typeof profile })
}
