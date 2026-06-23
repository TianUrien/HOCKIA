import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { Browser } from '@capacitor/browser'
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck'

const SOFT_DISMISS_KEY = 'native-update-prompt-dismissed-at'
const SOFT_DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000 // re-show the soft banner after a day

/**
 * Native App Store / Play Store update prompt (native only — driven by
 * useAppUpdateCheck against the app_version_requirements config). Distinct from
 * the web/PWA service-worker UpdatePrompt ("refresh now"); this one opens the
 * store listing because a native build can only update through the store.
 *  - 'force' → blocking modal, no dismiss (build below minimum supported)
 *  - 'soft'  → dismissible banner (a newer version is available)
 */
export default function NativeUpdatePrompt() {
  const { status, storeUrl } = useAppUpdateCheck()
  const [dismissed, setDismissed] = useState(() => {
    try {
      const at = localStorage.getItem(SOFT_DISMISS_KEY)
      return !!at && Date.now() - parseInt(at, 10) < SOFT_DISMISS_WINDOW_MS
    } catch {
      return false
    }
  })

  const openStore = () => { void Browser.open({ url: storeUrl }) }

  const dismiss = () => {
    try { localStorage.setItem(SOFT_DISMISS_KEY, Date.now().toString()) } catch { /* storage blocked */ }
    setDismissed(true)
  }

  if (status === 'ok') return null

  // ── Force update — blocking, cannot be dismissed ──
  if (status === 'force') {
    return (
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Download className="w-7 h-7 text-indigo-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Update required</h2>
          <p className="text-sm text-gray-600 mb-5">
            Please update HOCKIA to continue. This version is no longer supported.
          </p>
          <button
            type="button"
            onClick={openStore}
            className="w-full py-3 px-4 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Update HOCKIA
          </button>
        </div>
      </div>
    )
  }

  // ── Soft update — dismissible banner ──
  if (dismissed) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50 animate-slide-up">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Update available</h3>
          <p className="text-xs text-gray-600 mt-0.5">
            A new version of HOCKIA is available with the latest improvements.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={openStore}
          className="flex-1 py-2.5 px-4 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> Update now
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Later
        </button>
      </div>
    </div>
  )
}
