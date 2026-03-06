import { useState, useEffect } from 'react'
import { 
  ArrowLeft, 
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
  ExternalLink
} from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import Header from '@/components/Header'
import DeleteAccountModal from '@/components/DeleteAccountModal'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { trackPushSubscribe, trackPushUnsubscribe } from '@/lib/analytics'

// App version - could be pulled from package.json in the future
const APP_VERSION = '1.0.0'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile, signOut } = useAuthStore()
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('account')
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
      logger.error('Failed to toggle push notifications:', error)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (passwordForm.newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (!/[a-z]/.test(passwordForm.newPassword) || !/[A-Z]/.test(passwordForm.newPassword) || !/\d/.test(passwordForm.newPassword)) {
      setPasswordError('Password must include uppercase, lowercase, and a number')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    if (!passwordForm.currentPassword) {
      setPasswordError('Please enter your current password')
      return
    }

    setPasswordLoading(true)

    try {
      // Verify the current password before allowing the change
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: passwordForm.currentPassword,
      })

      if (verifyError) {
        throw new Error('Current password is incorrect')
      }

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
      const errorMessage = error instanceof Error ? error.message : 'Failed to update password'
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
      setEmailError('Please enter a different email address')
      return
    }

    setEmailLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ email: trimmed })
      if (error) throw error

      setEmailSuccess(true)
      setNewEmail('')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update email'
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
    setExpandedSection(expandedSection === section ? null : section)
  }

  if (!user || !profile) {
    return null
  }

  // Section header component
  const SectionHeader = ({ 
    id, 
    icon: Icon, 
    title, 
    iconBg 
  }: { 
    id: string
    icon: React.ElementType
    title: string
    iconBg: string 
  }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors rounded-xl"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <ChevronRight 
        className={`w-5 h-5 text-gray-400 transition-transform ${
          expandedSection === id ? 'rotate-90' : ''
        }`} 
      />
    </button>
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-2xl mx-auto px-4 md:px-6 pt-24 pb-32">
        {/* Back Button */}
        <button
          onClick={() => navigate('/dashboard/profile')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">Back</span>
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
              <p className="text-gray-600 mt-1">Manage your account and preferences</p>
            </div>
            <span className="px-3 py-1 rounded-full text-sm font-medium capitalize bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white">
              {profile.role}
            </span>
          </div>
        </div>

        {/* Settings Sections */}
        <div className="space-y-4">
          
          {/* ACCOUNT SECTION */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <SectionHeader 
              id="account" 
              icon={Mail} 
              title="Account" 
              iconBg="bg-blue-50 text-blue-600" 
            />
            
            {expandedSection === 'account' && (
              <div className="px-4 pb-4 space-y-4">
                {/* Login Email */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">Login Email</span>
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle className="w-3 h-3" />
                      Verified
                    </span>
                  </div>
                  <p className="text-gray-900 font-medium">{user.email}</p>

                  {emailSuccess ? (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Confirmation sent to your new email. Check both inboxes to confirm the change.
                    </p>
                  ) : (
                    <form onSubmit={handleEmailChange} className="mt-3 flex gap-2">
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="New email address"
                        className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                        required
                      />
                      <button
                        type="submit"
                        disabled={emailLoading}
                        className="px-4 py-2 text-sm font-medium text-white bg-[#8026FA] rounded-lg hover:bg-[#6b1ed4] transition-colors disabled:opacity-50"
                      >
                        {emailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Change'}
                      </button>
                    </form>
                  )}
                  {emailError && (
                    <p className="text-xs text-red-600 mt-1">{emailError}</p>
                  )}
                </div>

                {/* Change Password */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Lock className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-600">Change Password</span>
                  </div>
                  
                  <form onSubmit={handlePasswordChange} className="space-y-3">
                    <input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) =>
                        setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                      }
                      placeholder="Current password"
                      className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                        }
                        placeholder="New password"
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                      />
                      <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                        }
                        placeholder="Confirm"
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                      />
                    </div>

                    {passwordError && (
                      <p className="text-xs text-red-600">{passwordError}</p>
                    )}
                    {passwordSuccess && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Password updated. All other sessions have been signed out.
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={passwordLoading}
                      className="w-full px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {passwordLoading ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                </div>

                {/* Delete Account */}
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="w-full flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-5 h-5 text-red-600" />
                    <span className="text-red-700 font-medium">Delete Account</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-red-400 group-hover:text-red-600" />
                </button>
              </div>
            )}
          </div>

          {/* NOTIFICATIONS SECTION */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <SectionHeader 
              id="notifications" 
              icon={Bell} 
              title="Notifications" 
              iconBg="bg-indigo-50 text-indigo-600" 
            />
            
            {expandedSection === 'notifications' && (
              <div className="px-4 pb-4 space-y-3">
                {/* Players/Coaches: Opportunity Notifications */}
                {(profile.role === 'player' || profile.role === 'coach') && (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1 pr-4">
                      <p className="text-gray-900 font-medium text-sm">Opportunity Notifications</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Email when clubs publish new opportunities
                      </p>
                    </div>
                    <button
                      onClick={handleNotificationToggle}
                      disabled={loadingToggles.has('opportunities')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        notifyOpportunities ? 'bg-indigo-600' : 'bg-gray-300'
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
                      <p className="text-gray-900 font-medium text-sm">Application Notifications</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Email when players apply to your opportunities
                      </p>
                    </div>
                    <button
                      onClick={handleApplicationNotificationToggle}
                      disabled={loadingToggles.has('applications')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        notifyApplications ? 'bg-indigo-600' : 'bg-gray-300'
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
                    <p className="text-gray-900 font-medium text-sm">Friend Request Emails</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Email when someone sends you a friend request
                    </p>
                  </div>
                  <button
                    onClick={handleFriendNotificationToggle}
                    disabled={loadingToggles.has('friends')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                      notifyFriends ? 'bg-indigo-600' : 'bg-gray-300'
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

                {/* Reference Request Notifications -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">Reference Request Emails</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Email when someone requests a reference from you
                    </p>
                  </div>
                  <button
                    onClick={handleReferenceNotificationToggle}
                    disabled={loadingToggles.has('references')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                      notifyReferences ? 'bg-indigo-600' : 'bg-gray-300'
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

                {/* Message Digest Notifications -- All roles */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <p className="text-gray-900 font-medium text-sm">Message Email Digests</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Email digest for unread messages (max once every 6 hours)
                    </p>
                  </div>
                  <button
                    onClick={handleMessageNotificationToggle}
                    disabled={loadingToggles.has('messages')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                      notifyMessages ? 'bg-indigo-600' : 'bg-gray-300'
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
                    <p className="text-gray-900 font-medium text-sm">Push Notifications</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {!push.isSupported
                        ? 'Not supported in this browser'
                        : push.permission === 'denied'
                          ? 'Blocked — enable in browser settings'
                          : 'Receive notifications even when the app is closed'}
                    </p>
                  </div>
                  <button
                    onClick={handlePushToggle}
                    disabled={!push.isSupported || push.permission === 'denied' || push.loading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                      push.isSubscribed ? 'bg-indigo-600' : 'bg-gray-300'
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

                {notificationSuccess && (
                  <p className="text-xs text-green-600 flex items-center gap-1 px-4">
                    <CheckCircle className="w-3 h-3" />
                    Preferences updated
                  </p>
                )}
              </div>
            )}
          </div>

          {/* SUPPORT SECTION */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <SectionHeader 
              id="support" 
              icon={HelpCircle} 
              title="Support" 
              iconBg="bg-green-50 text-green-600" 
            />
            
            {expandedSection === 'support' && (
              <div className="px-4 pb-4">
                <LinkRow 
                  to="mailto:team@oplayr.com" 
                  icon={Mail} 
                  label="Contact Support" 
                  external 
                />
              </div>
            )}
          </div>

          {/* LEGAL SECTION */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <SectionHeader 
              id="legal" 
              icon={Shield} 
              title="Legal" 
              iconBg="bg-purple-50 text-purple-600" 
            />
            
            {expandedSection === 'legal' && (
              <div className="px-4 pb-4 space-y-1">
                <LinkRow to="/privacy-policy" icon={Shield} label="Privacy Policy" />
                <LinkRow to="/terms" icon={FileText} label="Terms of Service" />
              </div>
            )}
          </div>

          {/* ABOUT SECTION */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <SectionHeader 
              id="about" 
              icon={Info} 
              title="About" 
              iconBg="bg-gray-100 text-gray-600" 
            />
            
            {expandedSection === 'about' && (
              <div className="px-4 pb-4 space-y-1">
                {/* Version */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Info className="w-5 h-5 text-gray-500" />
                    <span className="text-gray-700">Version</span>
                  </div>
                  <span className="text-gray-500 text-sm">{APP_VERSION}</span>
                </div>
                
                <LinkRow to="/developers" icon={Code} label="For Developers" />
              </div>
            )}
          </div>

          {/* SIGN OUT BUTTON */}
          <button
            onClick={handleSignOut}
            disabled={signOutLoading}
            className="w-full flex items-center justify-center gap-2 p-4 bg-white rounded-2xl shadow-sm border border-gray-200 hover:bg-red-50 hover:border-red-200 transition-colors text-red-600 font-medium disabled:opacity-50"
          >
            {signOutLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
            <span>{signOutLoading ? 'Signing out...' : 'Sign Out'}</span>
          </button>

        </div>
      </main>

      {/* Delete Account Modal */}
      <DeleteAccountModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        userEmail={user.email || ''}
      />
    </div>
  )
}
