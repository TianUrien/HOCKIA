import { create } from 'zustand'
import * as Sentry from '@sentry/react'
import type { User, PostgrestError, Session, AuthError } from '@supabase/supabase-js'
import { AuthApiError } from '@supabase/supabase-js'
import type { Profile, ProfileInsert } from './supabase'
import { supabase, AUTH_STORAGE_KEY } from './supabase'
import { getAuthRedirectUrl } from './siteUrl'
import { requestCache, generateCacheKey } from './requestCache'
import { monitor } from './monitor'
import { logger } from './logger'
import { useUnreadStore } from './unread'
import { reportSupabaseError, reportAuthFlowError } from './sentryHelpers'
import { setUserProperties, clearUserProperties, trackLogin } from './analytics'
import { trackDbEvent } from './trackDbEvent'
import { trackUserDevice } from './trackUserDevice'
import { detectPlatform } from './detectPlatform'

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  hasCompletedOnboardingRedirect: boolean
  profileStatus: 'idle' | 'fetching' | 'missing' | 'loaded' | 'error'
  profileFetchedAt: number | null
  setUser: (user: User | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  setHasCompletedOnboardingRedirect: (value: boolean) => void
  signOut: () => Promise<void>
  fetchProfile: (userId: string, options?: { force?: boolean }) => Promise<void>
  refreshProfile: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  hasCompletedOnboardingRedirect: false,
  profileStatus: 'idle',
  profileFetchedAt: null,
  
  setUser: (user) => set({ user }),
  setProfile: (profile) => set((state) => ({
    profile,
    profileStatus: profile ? 'loaded' : state.profileStatus,
    profileFetchedAt: profile ? Date.now() : state.profileFetchedAt
  })),
  setLoading: (loading) => set({ loading }),
  setHasCompletedOnboardingRedirect: (value) => set({ hasCompletedOnboardingRedirect: value }),
  
  signOut: async () => {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'auth.signOut.global',
      level: 'info'
    })
    const { error } = await supabase.auth.signOut({ scope: 'global' })

    if (error) {
      logger.error('[AUTH_STORE] Failed to sign out via Supabase', { error })
      reportSupabaseError('auth_flow.global_sign_out', error, undefined, {
        feature: 'auth_flow',
        operation: 'sign_out'
      })
      await clearLocalSession('manual-sign-out-fallback', { skipSupabaseSignOut: true })
      throw error
    }

    await clearLocalSession('manual-sign-out', { skipSupabaseSignOut: true })
  },

  refreshProfile: async () => {
    const userId = get().user?.id
    if (!userId) return
    await get().fetchProfile(userId, { force: true })
  },
  
  fetchProfile: async (userId, options) => {
    const cacheKey = generateCacheKey('profile', { id: userId })
    const forceRefresh = options?.force ?? false
    const startedAt = Date.now()
    set({ profileStatus: 'fetching' })

    try {
      if (forceRefresh) {
        requestCache.invalidate(cacheKey)
      }
      const fetchOnce = async () => {
        Sentry.addBreadcrumb({
          category: 'supabase',
          message: 'profiles.fetch',
          data: { userId },
          level: 'info'
        })
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        if (error) {
          const pgError = error as PostgrestError
          if (pgError.code === 'PGRST116' || pgError.details?.includes('0 rows')) {
            return null
          }
          reportSupabaseError('auth_flow.fetch_profile', error, { userId }, {
            feature: 'auth_flow',
            operation: 'fetch_profile'
          })
          throw error
        }
        return data
      }

      let data = await monitor.measure('fetch_profile', async () => {
        return await requestCache.dedupe(cacheKey, fetchOnce)
      }, { userId })

      const duration = Date.now() - startedAt
      if (!data) {
        const currentUser = get().user
        const roleMetadata = (currentUser?.user_metadata?.role as string | undefined) ?? null
        const email = currentUser?.email ?? null

        if (currentUser && roleMetadata && email) {
          logger.info('[AUTH_STORE] Creating placeholder profile', { userId, role: roleMetadata })
          const insertPayload: ProfileInsert = {
            id: currentUser.id,
            email,
            role: roleMetadata,
            full_name: '',
            base_location: '',
            nationality: ''
          }

          Sentry.addBreadcrumb({
            category: 'supabase',
            message: 'profiles.placeholder_insert',
            data: { userId },
            level: 'info'
          })
          const { data: inserted, error: insertError } = await supabase
            .from('profiles')
            .insert(insertPayload)
            .select('*')
            .single()

          if (insertError) {
            const pgInsertError = insertError as PostgrestError
            if (pgInsertError.code === '23505') {
              logger.warn('[AUTH_STORE] Profile already existed during placeholder insert, retrying fetch', { userId })
              requestCache.invalidate(cacheKey)
              data = await requestCache.dedupe(cacheKey, fetchOnce)
            } else {
              logger.error('[AUTH_STORE] Error creating placeholder profile', { userId, insertError })
              reportSupabaseError('auth_flow.placeholder_profile_insert', insertError, { userId }, {
                feature: 'auth_flow',
                operation: 'create_profile'
              })
            }
          } else {
            data = inserted
          }
        } else {
          logger.error('[AUTH_STORE] Cannot create placeholder profile - missing metadata', { userId, hasUser: !!currentUser, roleMetadata, emailPresent: !!email })
        }
      }

      const resolvedAt = Date.now()
      if (data) {
        logger.debug('[AUTH_STORE] Profile fetched', { userId, duration })
        set({ profile: data, profileStatus: 'loaded', profileFetchedAt: resolvedAt })
        // Set GA4 user properties for analytics tracking
        setUserProperties(userId, data.role)
      } else {
        logger.warn('[AUTH_STORE] Profile missing after fetch', { userId, duration })
        set({ profile: null, profileStatus: 'missing', profileFetchedAt: resolvedAt })
      }
    } catch (error) {
      logger.error('[AUTH_STORE] Error fetching profile', { userId, error })
      set({ profileStatus: 'error', profileFetchedAt: Date.now() })
    }
  }
}))

const localStorageAvailable = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

interface ClearSessionOptions {
  skipSupabaseSignOut?: boolean
}

const clearLocalSession = async (reason: string, options?: ClearSessionOptions) => {
  logger.warn('[AUTH_STORE] Clearing local session', { reason })

  if (!options?.skipSupabaseSignOut) {
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'auth.signOut.local',
        data: { reason },
        level: 'info'
      })
      await supabase.auth.signOut({ scope: 'local' })
    } catch (signOutError) {
      logger.error('[AUTH_STORE] Failed to clear local session', { reason, signOutError })
      reportSupabaseError('auth_flow.local_sign_out', signOutError, { reason }, {
        feature: 'auth_flow',
        operation: 'sign_out'
      })
    }
  }

  requestCache.clear()

  try {
    useUnreadStore.getState().reset()
  } catch (unreadResetError) {
    logger.error('[AUTH_STORE] Failed to reset unread store during sign-out', { unreadResetError })
  }

  // Remove ALL realtime channels to prevent leaked subscriptions across sessions.
  // Individual stores (unread, notifications) clean their own channels, but this
  // catches any orphaned channels from unmounted components (e.g. chat, messages page).
  try {
    const channels = supabase.getChannels()
    if (channels.length > 0) {
      logger.debug('[AUTH_STORE] Removing all realtime channels on sign-out', { count: channels.length })
      await supabase.removeAllChannels()
    }
  } catch (channelError) {
    logger.error('[AUTH_STORE] Failed to remove realtime channels during sign-out', { channelError })
  }

  if (localStorageAvailable()) {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      // Also clear onboarding + pending state so the NEXT user who logs in
      // on this browser doesn't inherit the previous user's role / email.
      window.localStorage.removeItem('pending_role')
      window.localStorage.removeItem('pending_email')
    } catch (storageError) {
      logger.error('[AUTH_STORE] Failed to remove cached session from storage', { storageError })
    }
  }

  // Clear cross-tab auth intents too — redirect-after-login is stashed by
  // AuthScreen (for ?next= preservation) and ProtectedRoute (for unauth'd
  // deep links). Leaving it around lets the next login tab bounce to the
  // previous user's intended destination.
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem('hockia-redirect-after-login')
    } catch {
      /* noop */
    }
  }

  useAuthStore.setState({
    user: null,
    profile: null,
    loading: false,
    hasCompletedOnboardingRedirect: false,
    profileStatus: 'idle',
    profileFetchedAt: null
  })

  // Clear GA4 user properties
  clearUserProperties()

  Sentry.setUser(null)
}

export const isSessionExpiredError = (error: AuthError | null): error is AuthApiError => {
  if (!error) return false
  if (!(error instanceof AuthApiError)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token expired') ||
    msg.includes('refresh token not found') ||
    msg.includes('session expired') ||
    msg.includes('session not found') ||
    msg.includes('invalid claim') ||
    msg.includes('token is expired') ||
    error.status === 401 ||
    error.status === 403
  )
}

const handleSessionError = async (error: AuthError | null, context: string): Promise<boolean> => {
  if (!error) return false

  if (isSessionExpiredError(error)) {
    await clearLocalSession(context)
    return true
  }

  logger.error('[AUTH_STORE] Session error encountered', { context, error })
  return false
}

const clearPendingRole = () => {
  if (!localStorageAvailable()) return
  window.localStorage.removeItem('pending_role')
  window.localStorage.removeItem('pending_email')
}

const resolvePendingRole = (user: User | null): string | null => {
  if (!localStorageAvailable() || !user?.email) return null
  const pendingRole = window.localStorage.getItem('pending_role')
  const pendingEmail = window.localStorage.getItem('pending_email')
  if (pendingRole && pendingEmail && pendingEmail === user.email) {
    return pendingRole
  }
  return null
}

const ensureUserRoleMetadata = async (user: User | null): Promise<string | null> => {
  if (!user) return null

  const currentRole = typeof user.user_metadata?.role === 'string' && user.user_metadata.role
    ? (user.user_metadata.role as string)
    : null

  if (currentRole) {
    clearPendingRole()
    return currentRole
  }

  const pendingRole = resolvePendingRole(user)
  if (pendingRole) {
    logger.warn('[AUTH_STORE] Hydrating missing role metadata from localStorage fallback', { userId: user.id, pendingRole })
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'auth.updateUser.pendingRole',
      data: { userId: user.id },
      level: 'info'
    })
    const { data, error } = await supabase.auth.updateUser({ data: { role: pendingRole } })
    if (error) {
      logger.error('[AUTH_STORE] Failed to backfill role metadata from localStorage', { userId: user.id, error })
      reportSupabaseError('auth_flow.update_role_from_local_storage', error, { userId: user.id, pendingRole }, {
        feature: 'auth_flow',
        operation: 'update_role_metadata'
      })
    } else if (data.user) {
      useAuthStore.getState().setUser(data.user)
      clearPendingRole()
      return pendingRole
    }
  }

  const profileRole = useAuthStore.getState().profile?.role
  if (profileRole) {
    logger.warn('[AUTH_STORE] Backfilling missing role metadata from profile record', { userId: user.id, profileRole })
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'auth.updateUser.profileRole',
      data: { userId: user.id },
      level: 'info'
    })
    const { data, error } = await supabase.auth.updateUser({ data: { role: profileRole } })
    if (error) {
      logger.error('[AUTH_STORE] Failed to sync role metadata from profile', { userId: user.id, error })
      reportSupabaseError('auth_flow.update_role_from_profile', error, { userId: user.id, profileRole }, {
        feature: 'auth_flow',
        operation: 'update_role_metadata'
      })
    } else if (data.user) {
      useAuthStore.getState().setUser(data.user)
      clearPendingRole()
      return profileRole
    }
  }

  logger.error('[AUTH_STORE] Unable to determine role metadata for user', { userId: user.id })
  return null
}

const runSessionEffects = async (session: Session | null) => {
  const { setUser, fetchProfile } = useAuthStore.getState()
  const user = session?.user ?? null
  setUser(user)

  if (user) {
    const resolvedRole = await ensureUserRoleMetadata(user)
    const role = resolvedRole ?? (typeof user.user_metadata?.role === 'string' ? (user.user_metadata.role as string) : null)
    Sentry.setUser({ id: user.id, role: role ?? undefined })
    await fetchProfile(user.id)
    trackUserDevice()
  } else {
    useAuthStore.setState({ profile: null, profileStatus: 'idle', profileFetchedAt: null })
    Sentry.setUser(null)
  }
}

// Initialize auth listener
export const initializeAuth = () => {
  const { setLoading } = useAuthStore.getState()

  // Check current session
  supabase.auth.getSession().then(async ({ data: { session }, error }) => {
    const handled = await handleSessionError(error, 'getSession')
    if (handled) {
      setLoading(false)
      return
    }

    await runSessionEffects(session)
    setLoading(false)
  })

  // Listen for auth changes
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // If we already have an authenticated user and the incoming event carries
    // the same user, skip heavy re-processing. This prevents cascading state
    // resets (loading flash → ProtectedRoute unmounts children → form state
    // lost) caused by:
    //   - TOKEN_REFRESHED: JWT renewed on tab focus
    //   - SIGNED_IN via broadcast channel: another HOCKIA tab refreshed its token
    // We still process SIGNED_OUT (clear session) and USER_UPDATED (metadata
    // changed) which represent real user-state changes.
    const currentUser = useAuthStore.getState().user
    if (
      currentUser &&
      session?.user?.id === currentUser.id &&
      event !== 'SIGNED_OUT' &&
      event !== 'USER_UPDATED'
    ) {
      logger.debug('[AUTH_STORE] Auth event with same user, skipping', { event })
      return
    }

    setLoading(true)

    if (!session && event === 'SIGNED_OUT') {
      clearLocalSession('onAuthStateChange-signed-out', { skipSupabaseSignOut: true })
        .finally(() => setLoading(false))
      return
    }

    if (event === 'SIGNED_IN' && session?.user) {
      const provider = session.user.app_metadata?.provider
      const method: 'google' | 'apple' | 'email' =
        provider === 'google' ? 'google' : provider === 'apple' ? 'apple' : 'email'
      Sentry.setTag('auth_method', method)
      Sentry.addBreadcrumb({
        category: 'auth',
        level: 'info',
        message: 'auth.signed_in',
        data: { method, platform: detectPlatform() },
      })
      trackLogin(method)
      trackDbEvent('login', undefined, undefined, { method, platform: detectPlatform() })
      trackUserDevice()
    }

    runSessionEffects(session)
      .catch((error) => {
        logger.error('[AUTH_STORE] Error handling auth state change', { error, event })
        reportAuthFlowError('auth_state_change.run_session_effects', error, {
          event,
          userId: session?.user?.id ?? null,
          provider: session?.user?.app_metadata?.provider ?? null,
        })
      })
      .finally(() => setLoading(false))
  })

  return subscription
}

/**
 * Resend email verification
 * Used when user didn't receive the initial verification email
 */
export const resendVerificationEmail = async (email: string): Promise<{ success: boolean; error?: string }> => {
  try {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'auth.resendVerificationEmail',
      data: { email },
      level: 'info'
    })
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
      }
    })

    if (error) {
      logger.error('Error resending verification email:', error)
      reportSupabaseError('auth_flow.resend_verification', error, { email }, {
        feature: 'auth_flow',
        operation: 'resend_verification'
      })
      
      // Handle specific error cases
      if (error.message.includes('rate limit')) {
        return { success: false, error: 'Too many requests. Please wait a few minutes before trying again.' }
      }
      
      if (error.message.includes('already confirmed')) {
        return { success: false, error: 'This email is already verified. Try signing in.' }
      }
      
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    logger.error('Unexpected error resending verification:', err)
    reportSupabaseError('auth_flow.resend_verification_unexpected', err, { email }, {
      feature: 'auth_flow',
      operation: 'resend_verification'
    })
    return { success: false, error: 'An unexpected error occurred. Please try again.' }
  }
}
