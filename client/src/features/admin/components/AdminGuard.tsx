/**
 * AdminGuard Component
 * 
 * Protects admin routes by verifying admin status.
 * Redirects non-admins to the home page.
 */

import { Navigate } from 'react-router-dom'
import { useAdmin } from '../hooks/useAdmin'
import { logger } from '@/lib/logger'
import { PageSpinner } from '@/components/ui/PageSpinner'

interface AdminGuardProps {
  children: React.ReactNode
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAdmin, isLoading, error } = useAdmin()

  // Show loading state while checking admin status
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <PageSpinner className="mb-4 inline-block" />
          <p className="text-gray-600">Verifying admin access...</p>
        </div>
      </div>
    )
  }

  // Show error if verification failed
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Return to Home
          </a>
        </div>
      </div>
    )
  }

  // Redirect if not admin
  if (!isAdmin) {
    logger.warn('[AdminGuard] Access denied - user is not an admin')
    return <Navigate to="/" replace />
  }

  // Render admin content
  return <>{children}</>
}
