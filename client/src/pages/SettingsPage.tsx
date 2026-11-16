import { useState, useEffect } from 'react'
import {
  Mail,
  Lock,
  Trash2,
  CheckCircle,
  Bell,
  Loader2,
  ChevronRight,
  Shield,
  FileText,
  HelpCircle,
  Info,
  Code,
  LogOut,
  ExternalLink,
  EyeOff,
  Languages
} from 'lucide-react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import Footer from '@/components/Footer'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { FullMatchVisibilitySetting } from '@/components/settings/FullMatchVisibilitySetting'
import { logger } from '@/lib/logger'
import Header from '@/components/Header'
import SettingsMobile, { type SettingsSection } from '@/components/settings/SettingsMobile'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import DeleteAccountModal from '@/components/DeleteAccountModal'
import BlockedAccountsList from '@/components/BlockedAccountsList'
import StagingQaResetCard from '@/components/StagingQaResetCard'
import AboutAppCard from '@/components/AboutAppCard'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { useToastStore } from '@/lib/toast'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { trackPushSubscribe, trackPushUnsubscribe } from '@/lib/analytics'
import { captchaErrorMessage, getCaptchaToken, reportCaptchaCoverage } from '@/lib/captcha'
import { switchTrackClass } from '@/components/ui/switchClasses'
import { LanguageSwitch } from '@/components/LanguageSwitch'
import { useCommonT } from '@/i18n/ns/common'
import { useSettingsT } from '@/i18n/ns/settings'

/** `label` is a key in the settings catalog; the language entry uses the shared `language.label`. */
const SETTINGS_NAV = [
  { id: 'account', label: 'page.navAccount' },
  { id: 'notifications', label: 'page.navNotifications' },
  { id: 'privacy', label: 'page.navPrivacy' },
  { id: 'language', label: null },
  { id: 'support', label: 'page.navSupport' },
  { id: 'legal', label: 'page.navLegal' },
  { id: 'about', label: 'page.navAbout' },
] as const

export default function SettingsPage() {
  const t = useSettingsT()
  const languageLabel = useCommonT()('language.label')
  useDocumentTitle(t('page.documentTitle'))
  const navigate = useNavigate()
  const { user, profile, refreshProfile, signOut } = useAuthStore()
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const { section: routeSection } = useParams<{ section?: string }>()
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string>('account')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Email change state
  const [newEmail, setNewEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSuccess, setEmailSuccess] = useState(false)

  // Notification preferences state
  const [notifyOpportunities, setNotifyOpportunities] = useState(true)
  const [notifyApplications, setNotifyApplications] = useState(true)
  const [notifyFriends, setNotifyFriends] = useState(true)
  const [notifyReferences, setNotifyReferences] = useState(true)
  const [notifyMessages, setNotifyMessages] = useState(true)
  const [notifyProfileViews, setNotifyProfileViews] = useState(true)
  const [browseAnonymously, setBrowseAnonymously] = useState(false)
  // Defaults true so the UI never flickers "hidden" before the profile
  // loads — matches the column's NOT NULL DEFAULT true on the DB side.
  const [showLastActive, setShowLastActive] = useState(true)
  const [loadingToggles, setLoadingToggles] = useState<Set<string>>(new Set())
  const [notificationSuccess, setNotificationSuccess] = useState(false)

  const setToggleLoading = (key: string, loading: boolean) => {
    setLoadingToggles(prev => {
      const next = new Set(prev)
      if (loading) next.add(key)
      else next.delete(key)
      return next
    })
  }

  // Push notification subscription
  const push = usePushSubscription()
  const { addToast } = useToastStore()

  // Sign out loading state
  const [signOutLoading, setSignOutLoading] = useState(false)

  // Load notification preferences from profile
  useEffect(() => {
    if (profile) {
      setNotifyOpportunities(profile.notify_opportunities ?? true)
      setNotifyApplications(profile.notify_applications ?? true)
      setNotifyFriends(profile.notify_friends ?? true)
      setNotifyReferences(profile.notify_references ?? true)
      setNotifyMessages(profile.notify_messages ?? true)
      setNotifyProfileViews(profile.notify_profile_views ?? true)
      setBrowseAnonymously(profile.browse_anonymously ?? false)
      // Profile may not have show_last_active yet on first load (column
      // added 2026-05-08); default to true matches the DB default and
      // avoids a brief "hidden" UI flash before the column populates.
      const profileWithLastActive = profile as typeof profile & { show_last_active?: boolean | null }
      setShowLastActive(profileWithLastActive.show_last_active ?? true)
    }
  }, [profile])

  const handleNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyOpportunities
    setToggleLoading('opportunities', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_opportunities: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyOpportunities(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update notification preferences:', error)
      setNotifyOpportunities(!newValue)
    } finally {
      setToggleLoading('opportunities', false)
    }
  }

  const handleApplicationNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyApplications
    setToggleLoading('applications', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_applications: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyApplications(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update notification preferences:', error)
      setNotifyApplications(!newValue)
    } finally {
      setToggleLoading('applications', false)
    }
  }

  const handleFriendNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyFriends
    setToggleLoading('friends', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_friends: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyFriends(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update notification preferences:', error)
      setNotifyFriends(!newValue)
    } finally {
      setToggleLoading('friends', false)
    }
  }

  const handleReferenceNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyReferences
    setToggleLoading('references', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_references: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyReferences(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update notification preferences:', error)
      setNotifyReferences(!newValue)
    } finally {
      setToggleLoading('references', false)
    }
  }

  const handleMessageNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyMessages
    setToggleLoading('messages', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_messages: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyMessages(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update notification preferences:', error)
      setNotifyMessages(!newValue)
    } finally {
      setToggleLoading('messages', false)
    }
  }

  const handlePushToggle = async () => {
    if (!push.isSupported) return

    try {
      if (push.isSubscribed) {
        await push.unsubscribe()
        trackPushUnsubscribe()
      } else {
        await push.subscribe()
        trackPushSubscribe('settings')
      }
      setNotificationSuccess(true)
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      // Surface a clear error instead of leaving the toggle silently reverted —
      // the toggle's own `loading` always resets (finally in subscribe/unsubscribe),
      // so it never stays stuck, but the user still deserves to know it failed.
      logger.error('Failed to toggle push notifications:', error)
      addToast(t('errors.pushFailedDesktop'), 'error')
    }
  }

  const handleProfileViewNotificationToggle = async () => {
    if (!user) return

    const newValue = !notifyProfileViews
    setToggleLoading('profile_views', true)
    setNotificationSuccess(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notify_profile_views: newValue })
        .eq('id', user.id)

      if (error) throw error

      setNotifyProfileViews(newValue)
      setNotificationSuccess(true)

      await refreshProfile()
      setTimeout(() => setNotificationSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to update profile view notification preferences:', error)
      setNotifyProfileViews(!newValue)
    } finally {
      setToggleLoading('profile_views', false)
    }
  }

  const handleAnonymousBrowsingToggle = async () => {
    if (!user) return

    const newValue = !browseAnonymously
    setToggleLoading('anonymous', true)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ browse_anonymously: newValue })
        .eq('id', user.id)

      if (error) throw error

      setBrowseAnonymously(newValue)
      await refreshProfile()
    } catch (error) {
      logger.error('Failed to update anonymous browsing:', error)
      setBrowseAnonymously(!newValue)
    } finally {
      setToggleLoading('anonymous', false)
    }
  }

  const handleShowLastActiveToggle = async () => {
    if (!user) return

    const newValue = !showLastActive
    setToggleLoading('last-active', true)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ show_last_active: newValue })
        .eq('id', user.id)

      if (error) throw error

      setShowLastActive(newValue)
      await refreshProfile()
    } catch (error) {
      logger.error('Failed to update last-active visibility:', error)
      setShowLastActive(!newValue)
    } finally {
      setToggleLoading('last-active', false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (passwordForm.newPassword.length < 8) {
      setPasswordError(t('errors.passwordTooShort'))
      return
    }
    if (!/[a-z]/.test(passwordForm.newPassword) || !/[A-Z]/.test(passwordForm.newPassword) || !/\d/.test(passwordForm.newPassword)) {
      setPasswordError(t('errors.passwordWeak'))
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t('errors.passwordMismatch'))
      return
    }

    if (!passwordForm.currentPassword) {
      setPasswordError(t('errors.currentPasswordMissing'))
      return
    }

    setPasswordLoading(true)

    try {
      // Verify the current password before allowing the change
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: passwordForm.currentPassword,
        options: { captchaToken: await getCaptchaToken('reverify') },
      })

      if (verifyError) {
        throw new Error(captchaErrorMessage(verifyError.message) ?? t('errors.currentPasswordWrong'))
      }
      reportCaptchaCoverage('reverify')

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      })

      if (error) throw error

      // Security: Sign out all OTHER sessions (keep current session valid)
      // This ensures any potentially compromised sessions are invalidated
      await supabase.auth.signOut({ scope: 'others' })

      setPasswordSuccess(true)
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })

      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : t('errors.passwordFailed')
      setPasswordError(errorMessage)
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError('')
    setEmailSuccess(false)

    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed || trimmed === user?.email) {
      setEmailError(t('errors.emailSame'))
      return
    }

    setEmailLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ email: trimmed })
      if (error) throw error

      setEmailSuccess(true)
      setNewEmail('')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : t('errors.emailFailed')
      setEmailError(errorMessage)
    } finally {
      setEmailLoading(false)
    }
  }

  const handleSignOut = async () => {
    setSignOutLoading(true)
    try {
      await signOut()
      navigate('/')
    } catch (error) {
      logger.error('Failed to sign out:', error)
    } finally {
      setSignOutLoading(false)
    }
  }

  const toggleSection = (section: string) => {
    setExpandedSection(section)
  }

  if (!user || !profile) {
    return null
  }

  // Section header component
  // Rebrand page 27 · Settings (web): the left nav picks the section; the
  // panel shows only that section under a static heading (no accordion).
  const sectionCard = (id: string) =>
    `overflow-hidden rounded-[20px] bg-white ring-1 ring-inset ring-line ${expandedSection === id ? '' : 'hidden'}`

  const SectionHeader = ({
    icon: Icon,
    title,
    iconBg,
  }: {
    id: string
    icon: React.ElementType
    title: string
    iconBg: string
  }) => (
    <div className="flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">{title}</h2>
    </div>
  )

  // Link row component for navigation items
  const LinkRow = ({ 
    to, 
    icon: Icon, 
    label, 
    external = false 
  }: { 
    to: string
    icon: React.ElementType
    label: string
    external?: boolean 
  }) => {
    if (external) {
      return (
        <a
          href={to}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg group"
        >
          <div className="flex items-center gap-3">
            <Icon className="w-5 h-5 text-gray-500" />
            <span className="text-gray-700">{label}</span>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
        </a>
      )
    }

    return (
      <Link
        to={to}
        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg group"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-gray-500" />
          <span className="text-gray-700">{label}</span>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
      </Link>
    )
  }


  // Phone: the Figma Settings hub and its Notifications / Privacy leaves.
  // /settings/account keeps this page (email, password, sessions) until the
  // Email & sign-in leaf exists.
  if (isPhone && routeSection !== 'account') {
    const section: SettingsSection = routeSection === 'notifications' || routeSection === 'privacy' || routeSection === 'blocked' ? routeSection : 'hub'
    return <SettingsMobile section={section} />
  }

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Header />

      <main className="mx-auto max-w-[1100px] px-4 pb-32 pt-under-header-lg md:px-6">
        <div className="mb-6">
          <h1 className="text-title text-ink-1">{t('page.title')}</h1>
        </div>

        <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8">
          <nav aria-label={t('page.sectionsLabel')} className="sticky top-24 flex flex-col gap-1">
            {SETTINGS_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleSection(item.id)}
                aria-current={expandedSection === item.id ? 'page' : undefined}
                className={`flex h-11 items-center rounded-full px-4 text-left text-[15px] font-medium transition-colors ${expandedSection === item.id ? 'bg-hockia-soft text-ink-1' : 'text-ink-2 hover:bg-surface-muted hover:text-ink-1'}`}
              >
                {item.label ? t(item.label) : languageLabel}
              </button>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signOutLoading}
              className="mt-2 flex h-11 items-center gap-2 rounded-full px-4 text-left text-[15px] font-medium text-status-danger transition-colors hover:bg-status-danger-soft disabled:opacity-50"
            >
              {signOutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {signOutLoading ? t('page.signingOut') : t('page.logOut')}
            </button>
          </nav>

          <div>
        {/* Settings Sections (gap, not space-y: hidden sections take no room) */}
        <div className="flex flex-col gap-4">
          
          {/* ACCOUNT SECTION */}
          <div className={sectionCard('account')}>
            <SectionHeader 
              id="account" 
              icon={Mail} 
              title={t('page.account')} 
              iconBg="bg-surface-muted text-ink-2" 
            />
            
            {expandedSection === 'account' && (
              <div className="px-4 pb-4 space-y-4">
                {/* Login Email */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">{t('account.loginEmail')}</span>
                    <span className="flex items-center gap-1 text-xs text-positive">
                      <CheckCircle className="w-3 h-3" />
                      {t('account.verified')}
                    </span>
                  </div>
                  <p className="text-gray-900 font-medium">{user.email}</p>

                  {emailSuccess ? (
                    <p className="text-xs text-positive mt-2 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {t('account.emailSent')}
                    </p>
                  ) : (
                    <form onSubmit={handleEmailChange} className="mt-3 flex gap-2">
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder={t('account.newEmailPlaceholder')}
                        className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                        required
                      />
                      <button
                        type="submit"
                        disabled={emailLoading}
                        className="px-4 py-2 text-sm font-medium text-white bg-hockia-primary rounded-lg hover:bg-[#6b1ed4] transition-colors disabled:opacity-50"
                      >
                        {emailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('account.changeEmail')}
                      </button>
                    </form>
                  )}
                  {emailError && (
                    <p className="text-xs text-red-600 mt-1">{emailError}</p>
                  )}
                </div>

                {/* Change password */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Lock className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-600">{t('account.changePassword')}</span>
                  </div>
                  
                  <form onSubmit={handlePasswordChange} className="space-y-3">
                    <input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) =>
                        setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                      }
                      placeholder={t('account.currentPassword')}
                      className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                        }
                        placeholder={t('account.newPassword')}
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                      />
                      <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                        }
                        placeholder={t('account.confirmPassword')}
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                      />
                    </div>

                    {passwordError && (
                      <p className="text-xs text-red-600">{passwordError}</p>
                    )}
                    {passwordSuccess && (
                      <p className="text-xs text-positive flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        {t('account.passwordUpdated')}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={passwordLoading}
                      className="w-full px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {passwordLoading ? t('account.updating') : t('account.updatePassword')}
                    </button>
                  </form>
                </div>

                {/* Delete account */}
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="w-full flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-5 h-5 text-red-600" />
                    <span className="text-red-700 font-medium">{t('account.deleteAccount')}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-red-400 group-hover:text-red-600" />
                </button>
              </div>
            )}
          </div>

          {/* NOTIFICATIONS SECTION */}
          <div className={sectionCard('notifications')}>
            <SectionHeader 
              id="notifications" 
              icon={Bell} 
              title={t('page.notifications')} 
              iconBg="bg-surface-muted text-ink-2" 
            />
            
            {expandedSection === 'notifications' && (
              <div className="px-4 pb-4 space-y-3">
                {/* Players/Coaches: Opportunity Notifications */}
                {(profile.role === 'player' || profile.role === 'coach') && (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1 pr-4">
                      <p className="text-gray-900 font-medium text-sm">{t('emails.opportunitiesTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('emails.opportunitiesBody')}
                      </p>
                    </div>
                    <button
                      onClick={handleNotificationToggle}
                      disabled={loadingToggles.has('opportunities')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                        switchTrackClass(notifyOpportunities)
                      } ${loadingToggles.has('opportunities') ? 'opacity-50' : ''}`}
                    >
                      {loadingToggles.has('opportunities') ? (
                        <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                      ) : (
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notifyOpportunities ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Clubs: Application Notifications */}
                {profile.role === 'club' && (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1 pr-4">
                      <p className="text-gray-900 font-medium text-sm">{t('emails.applicationsTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('emails.applicationsBody')}
                      </p>
                    </div>
                    <button
                      onClick={handleApplicationNotificationToggle}
                      disabled={loadingToggles.has('applications')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                        switchTrackClass(notifyApplications)
                      } ${loadingToggles.has('applications') ? 'opacity-50' : ''}`}
                    >
                      {loadingToggles.has('applications') ? (
                        <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                      ) : (
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notifyApplications ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Friend Request Notifications -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('emails.friendsTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('emails.friendsBody')}
                    </p>
                  </div>
                  <button
                    onClick={handleFriendNotificationToggle}
                    disabled={loadingToggles.has('friends')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(notifyFriends)
                    } ${loadingToggles.has('friends') ? 'opacity-50' : ''}`}
                  >
                    {loadingToggles.has('friends') ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifyFriends ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {/* Reference Request Notifications — umpires joined the
                    references system in Phase E, so they now see this toggle
                    alongside players/coaches. Clubs + brands still can't
                    collect references so the toggle stays hidden for them. */}
                {profile.role !== 'club' && profile.role !== 'brand' && (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1 pr-4">
                      <p className="text-gray-900 font-medium text-sm">{t('emails.referencesTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('emails.referencesBody')}
                      </p>
                    </div>
                    <button
                      onClick={handleReferenceNotificationToggle}
                      disabled={loadingToggles.has('references')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                        switchTrackClass(notifyReferences)
                      } ${loadingToggles.has('references') ? 'opacity-50' : ''}`}
                    >
                      {loadingToggles.has('references') ? (
                        <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                      ) : (
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notifyReferences ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Message Digest Notifications -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('emails.messagesTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('emails.messagesBody')}
                    </p>
                  </div>
                  <button
                    onClick={handleMessageNotificationToggle}
                    disabled={loadingToggles.has('messages')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(notifyMessages)
                    } ${loadingToggles.has('messages') ? 'opacity-50' : ''}`}
                  >
                    {loadingToggles.has('messages') ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifyMessages ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {/* Push Notifications -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('emails.pushTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {!push.isSupported
                        ? t('emails.pushUnsupported')
                        : push.permission === 'denied'
                          ? t('emails.pushBlocked')
                          : t('emails.pushBody')}
                    </p>
                  </div>
                  <button
                    onClick={handlePushToggle}
                    disabled={!push.isSupported || push.permission === 'denied' || push.loading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(push.isSubscribed)
                    } ${!push.isSupported || push.permission === 'denied' || push.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {push.loading ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          push.isSubscribed ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {/* Profile View Digest Emails -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('emails.profileViewsTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('emails.profileViewsBody')}
                    </p>
                  </div>
                  <button
                    onClick={handleProfileViewNotificationToggle}
                    disabled={loadingToggles.has('profile_views')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(notifyProfileViews)
                    } ${loadingToggles.has('profile_views') ? 'opacity-50' : ''}`}
                  >
                    {loadingToggles.has('profile_views') ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifyProfileViews ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {notificationSuccess && (
                  <p className="text-xs text-positive flex items-center gap-1 px-4">
                    <CheckCircle className="w-3 h-3" />
                    {t('emails.updated')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* PRIVACY SECTION */}
          <div className={sectionCard('privacy')}>
            <SectionHeader
              id="privacy"
              icon={EyeOff}
              title={t('page.privacy')}
              iconBg="bg-surface-muted text-ink-2"
            />

            {expandedSection === 'privacy' && (
              <div className="px-4 pb-4 space-y-3">
                <FullMatchVisibilitySetting />
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('privacy.anonymousTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('privacy.anonymousBody')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAnonymousBrowsingToggle}
                    disabled={loadingToggles.has('anonymous')}
                    aria-label={browseAnonymously ? t('privacy.anonymousOn') : t('privacy.anonymousOff')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(browseAnonymously)
                    } ${loadingToggles.has('anonymous') ? 'opacity-50' : ''}`}
                  >
                    {loadingToggles.has('anonymous') ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          browseAnonymously ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {/* Show Last Active — opt-out for the "Active today" hint in
                    Chat (profiles never show activity, ruling 2026-10-11). */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">{t('privacy.lastActiveTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('privacy.lastActiveBody')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleShowLastActiveToggle}
                    disabled={loadingToggles.has('last-active')}
                    aria-label={showLastActive ? t('privacy.lastActiveOn') : t('privacy.lastActiveOff')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
                      switchTrackClass(showLastActive)
                    } ${loadingToggles.has('last-active') ? 'opacity-50' : ''}`}
                  >
                    {loadingToggles.has('last-active') ? (
                      <Loader2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white animate-spin" />
                    ) : (
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          showLastActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    )}
                  </button>
                </div>

                {/* Blocked Accounts */}
                <div className="mt-4">
                  <p className="text-gray-900 font-medium text-sm mb-3">{t('privacy.blockedTitle')}</p>
                  <BlockedAccountsList />
                </div>
              </div>
            )}
          </div>

          {/* LANGUAGE SECTION */}
          <div className={sectionCard('language')}>
            <SectionHeader
              id="language"
              icon={Languages}
              title={languageLabel}
              iconBg="bg-surface-muted text-ink-2"
            />

            {expandedSection === 'language' && (
              <div className="px-4 pb-4">
                <LanguageSwitch />
              </div>
            )}
          </div>

          {/* SUPPORT SECTION */}
          <div className={sectionCard('support')}>
            <SectionHeader 
              id="support" 
              icon={HelpCircle} 
              title={t('page.support')} 
              iconBg="bg-surface-muted text-ink-2" 
            />
            
            {expandedSection === 'support' && (
              <div className="px-4 pb-4">
                <LinkRow 
                  to="mailto:team@inhockia.com"
                  icon={Mail} 
                  label={t('links.contactSupport')} 
                  external 
                />
              </div>
            )}
          </div>

          {/* LEGAL SECTION */}
          <div className={sectionCard('legal')}>
            <SectionHeader 
              id="legal" 
              icon={Shield} 
              title={t('page.legal')} 
              iconBg="bg-surface-muted text-ink-2" 
            />
            
            {expandedSection === 'legal' && (
              <div className="px-4 pb-4 space-y-1">
                <LinkRow to="/privacy-policy" icon={Shield} label={t('links.privacyPolicy')} />
                <LinkRow to="/terms" icon={FileText} label={t('links.terms')} />
              </div>
            )}
          </div>

          {/* ABOUT SECTION */}
          <div className={sectionCard('about')}>
            <SectionHeader 
              id="about" 
              icon={Info} 
              title={t('page.about')} 
              iconBg="bg-surface-muted text-ink-2" 
            />
            
            {expandedSection === 'about' && (
              <div className="px-4 pb-4 space-y-1">
                <AboutAppCard />
                <LinkRow to="/developers" icon={Code} label={t('links.developers')} />
              </div>
            )}
          </div>

          {/* STAGING-ONLY QA TOOLS — renders null in production */}
          <StagingQaResetCard />

        </div>
          </div>
        </div>
      </main>

      {/* Footer with legal links + official HOCKIA social channels. */}
      <Footer />

      {/* Delete account Modal */}
      <DeleteAccountModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        userEmail={user.email || ''}
      />
    </div>
  )
}
