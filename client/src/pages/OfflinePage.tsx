import { WifiOff, RefreshCw } from 'lucide-react'

export default function OfflinePage() {
  const handleRetry = () => {
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="mb-8">
          <img 
            src="/HockiaLogoBlack.svg"
            alt="HOCKIA"
            className="h-8 mx-auto"
          />
        </div>

        {/* Offline Icon */}
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <WifiOff className="w-10 h-10 text-gray-400" />
        </div>

        {/* Message */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          You're offline
        </h1>
        <p className="text-gray-600 mb-8">
          Check your internet connection and try again. Some features may be limited while offline.
        </p>

        {/* Retry Button */}
        <button
          onClick={handleRetry}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>

        {/* Offline Tips */}
        <div className="mt-12 text-left bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-2">
            While you're offline, you can:
          </h2>
          <ul className="text-sm text-gray-600 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              View previously loaded opportunities
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              Browse your cached profile
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400 mt-0.5">✗</span>
              <span className="text-gray-400">Send messages or applications</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
