import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Home } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'

export default function NotFoundPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

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

        {/* 404 indicator */}
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl font-bold text-gray-400">404</span>
        </div>

        {/* Message */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Page not found
        </h1>
        <p className="text-gray-600 mb-8">
          The page you're looking for doesn't exist or may have been moved.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
          <button
            onClick={() => navigate(user ? '/opportunities' : '/')}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Home className="w-4 h-4" />
            {user ? 'Opportunities' : 'Home'}
          </button>
        </div>
      </div>
    </div>
  )
}
