import { useState, useEffect } from 'react'
import { AlertTriangle, ExternalLink, Copy, Check, X } from 'lucide-react'
import { detectInAppBrowser, getExternalBrowserInstructions, openInExternalBrowser } from '@/lib/inAppBrowser'

interface InAppBrowserWarningProps {
  /** Context where the warning is shown - affects messaging */
  context?: 'signup' | 'login' | 'verification' | 'general'
  /** Whether to allow dismissing the warning */
  dismissible?: boolean
  /** Callback when user dismisses */
  onDismiss?: () => void
}

/**
 * Warning banner shown when users are in an in-app browser (Instagram, WhatsApp, etc.)
 * 
 * These browsers have limitations with OAuth, cookies, and session persistence
 * that can prevent successful signup/login.
 */
export default function InAppBrowserWarning({
  context = 'general',
  dismissible = true,
  onDismiss,
}: InAppBrowserWarningProps) {
  const [browserInfo, setBrowserInfo] = useState<ReturnType<typeof detectInAppBrowser> | null>(null)
  const [copied, setCopied] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)

  useEffect(() => {
    const info = detectInAppBrowser()
    setBrowserInfo(info)

    // Check if user previously dismissed this session
    const dismissed = sessionStorage.getItem('in-app-browser-warning-dismissed')
    if (dismissed) {
      setIsDismissed(true)
    }
  }, [])

  // Don't render if not in an in-app browser or dismissed
  if (!browserInfo?.isInAppBrowser || isDismissed) {
    return null
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = window.location.href
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenExternal = () => {
    const opened = openInExternalBrowser()
    if (!opened) {
      setShowInstructions(true)
    }
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    sessionStorage.setItem('in-app-browser-warning-dismissed', 'true')
    onDismiss?.()
  }

  const getMessage = () => {
    const browser = browserInfo.browserName || 'this app'
    
    switch (context) {
      case 'signup':
        return `You're viewing HOCKIA inside ${browser}. For the best signup experience, open this page in Safari or Chrome.`
      case 'login':
        return `${browser}'s browser may have trouble with login. Open in Safari or Chrome for a smoother experience.`
      case 'verification':
        return `Email verification works best when opened in Safari or Chrome, not inside ${browser}.`
      default:
        return `You're viewing HOCKIA inside ${browser}. Some features work better in Safari or Chrome.`
    }
  }

  const instructions = getExternalBrowserInstructions(browserInfo.browserName)

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 relative">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-800 font-medium">
              {getMessage()}
            </p>
            
            {showInstructions && (
              <p className="text-sm text-amber-700 mt-2 bg-amber-100 rounded-lg p-3">
                💡 {instructions}
              </p>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={handleOpenExternal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Browser
              </button>
              
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-amber-700 text-sm font-medium rounded-lg border border-amber-300 hover:bg-amber-50 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy Link
                  </>
                )}
              </button>

              {!showInstructions && (
                <button
                  onClick={() => setShowInstructions(true)}
                  className="text-sm text-amber-700 hover:text-amber-900 underline"
                >
                  Show me how
                </button>
              )}
            </div>
          </div>

          {dismissible && (
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-amber-100 rounded-full transition-colors flex-shrink-0"
              aria-label="Dismiss warning"
            >
              <X className="w-4 h-4 text-amber-600" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
