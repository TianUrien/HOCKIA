import { useState, useEffect, useCallback } from 'react'
import { X, Download, Share, Plus } from 'lucide-react'
import { trackPwaInstall, trackPwaInstallDismiss } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

type InstallState = 'idle' | 'can-install' | 'ios-safari' | 'installed'

// Version key — bumped to force re-tracking for users who hit the v1 bug
const TRACKED_KEY = 'pwa-install-tracked-v2'

function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

async function persistInstallToDb(platform: 'ios' | 'android' | 'desktop'): Promise<boolean> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) return false
  const { error } = await supabase.from('pwa_installs')
    .upsert(
      { profile_id: userId, platform, user_agent: navigator.userAgent },
      { onConflict: 'profile_id,platform' }
    )
  if (error) {
    logger.warn('[PWA] Failed to persist install:', error.message)
    return false
  }
  logger.info('[PWA] Install tracked:', platform)
  return true
}

export default function InstallPrompt() {
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)

  // Subscribe to auth state so we can react when user becomes available
  const userId = useAuthStore(state => state.user?.id)

  // Check if running as installed PWA
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  // Check if iOS Safari
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !('MSStream' in window)
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  const isIOSSafari = isIOS && isSafari

  // Check localStorage for dismissal
  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10)
      // Show again after 7 days
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        setIsDismissed(true)
      }
    }

    if (isStandalone) {
      setInstallState('installed')
    } else if (isIOSSafari) {
      setInstallState('ios-safari')
    }
  }, [isStandalone, isIOSSafari])

  // Track standalone installs — waits for auth to be ready before persisting
  useEffect(() => {
    if (!isStandalone) return
    if (!userId) return
    if (localStorage.getItem(TRACKED_KEY)) return

    const platform = detectPlatform()
    trackPwaInstall(platform)
    persistInstallToDb(platform).then(success => {
      if (success) {
        localStorage.setItem(TRACKED_KEY, '1')
      }
    })
  }, [isStandalone, userId])

  // Signal visibility to other components (PushPrompt reads this)
  useEffect(() => {
    const isVisible = !isDismissed && installState !== 'installed' && installState !== 'idle'
    if (isVisible) {
      localStorage.setItem('pwa-install-visible', '1')
    } else {
      localStorage.removeItem('pwa-install-visible')
    }
    return () => localStorage.removeItem('pwa-install-visible')
  }, [isDismissed, installState])

  // Listen for the install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setInstallState('can-install')
    }

    const handleAppInstalled = () => {
      setInstallState('installed')
      setDeferredPrompt(null)
      localStorage.removeItem('pwa-install-dismissed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setInstallState('installed')
      const platform = detectPlatform()
      trackPwaInstall(platform)
      const success = await persistInstallToDb(platform)
      if (success) localStorage.setItem(TRACKED_KEY, '1')
    }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setIsDismissed(true)
    localStorage.setItem('pwa-install-dismissed', Date.now().toString())
    trackPwaInstallDismiss()
  }, [])

  // Don't show if dismissed, already installed, or no install option
  if (isDismissed || installState === 'installed' || installState === 'idle') {
    return null
  }

  // iOS Safari instructions
  if (installState === 'ios-safari') {
    return (
      <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 md:left-auto md:right-4 md:bottom-6 md:w-80 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50 animate-slide-up">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>

        <div className="flex items-start gap-3">
          <img
            src="/pwa-icons/ios/100.png"
            alt="PLAYR"
            className="w-10 h-10 rounded-xl flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm">Install PLAYR</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Add to your home screen for the best experience
            </p>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-600 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 rounded text-[10px] font-medium">1</span>
            Tap <Share className="w-4 h-4 text-blue-500 inline mx-1" /> Share
          </p>
          <p className="text-xs text-gray-600 flex items-center gap-2 mt-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 rounded text-[10px] font-medium">2</span>
            Tap <Plus className="w-4 h-4 text-gray-700 inline mx-1" /> Add to Home Screen
          </p>
        </div>
      </div>
    )
  }

  // Standard install prompt (Chrome, Edge, Samsung, etc.)
  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 md:left-auto md:right-4 md:bottom-6 md:w-80 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50 animate-slide-up">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>

      <div className="flex items-start gap-3">
        <img
          src="/pwa-icons/android/android-launchericon-96-96.png"
          alt="PLAYR"
          className="w-10 h-10 rounded-xl flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Install PLAYR</h3>
          <p className="text-xs text-gray-600 mt-0.5">
            Get quick access from your home screen
          </p>
        </div>
      </div>

      <button
        onClick={handleInstall}
        className="mt-3 w-full py-2.5 px-4 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        <Download className="w-4 h-4" />
        Install App
      </button>
    </div>
  )
}
