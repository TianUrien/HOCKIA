import { RefreshCw } from 'lucide-react'

interface UpdatePromptProps {
  onUpdate: () => void
}

/**
 * UpdatePrompt - Shows when a new version of HOCKIA is available
 * 
 * Displays a non-intrusive banner at the top of the screen prompting
 * the user to refresh and get the latest version.
 */
export default function UpdatePrompt({ onUpdate }: UpdatePromptProps) {
  return (
    <div 
      className="fixed top-0 left-0 right-0 z-[100] animate-slide-down"
      role="alert"
      aria-live="polite"
    >
      <div className="bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4" />
            </div>
            <p className="text-sm font-medium truncate">
              A new version of HOCKIA is available
            </p>
          </div>
          <button
            onClick={onUpdate}
            className="flex-shrink-0 px-4 py-1.5 bg-white text-[#8026FA] text-sm font-semibold rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#8026FA]"
          >
            Refresh now
          </button>
        </div>
      </div>
    </div>
  )
}
