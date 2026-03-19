import { useNavigate } from 'react-router-dom'
import { Eye, ArrowLeft } from 'lucide-react'

/**
 * PublicViewBanner - Shows when a user is viewing their own profile in network mode
 * 
 * Displays a fixed banner below the navbar explaining that the user is
 * viewing how others see their profile, with a button to return to their dashboard.
 * 
 * This component is fixed positioned below the header (top-16 accounts for header height)
 * and includes a spacer div to push content down.
 */
export default function PublicViewBanner() {
  const navigate = useNavigate()

  const handleReturnToDashboard = () => {
    navigate('/dashboard/profile')
  }

  return (
    <>
      {/* Fixed banner below the navbar */}
      <div className="fixed top-[64px] left-0 right-0 z-40 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Eye className="w-5 h-5" />
              </div>
              <div className="text-center sm:text-left">
                <p className="font-semibold text-sm md:text-base">
                  You are viewing your network profile.
                </p>
                <p className="text-white/80 text-xs md:text-sm">
                  This is how other HOCKIA members see you.
                </p>
              </div>
            </div>
            <button
              onClick={handleReturnToDashboard}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#8026FA] rounded-lg hover:bg-white/90 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to My Profile
            </button>
          </div>
        </div>
      </div>
      {/* Spacer to push content below the fixed banner */}
      <div className="h-[72px] sm:h-[56px]" aria-hidden="true" />
    </>
  )
}
