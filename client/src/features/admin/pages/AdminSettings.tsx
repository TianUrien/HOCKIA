/**
 * AdminSettings Page
 * 
 * Admin-specific settings and configuration.
 */

import { useEffect } from 'react'
import { Settings, Info } from 'lucide-react'

export function AdminSettings() {
  useEffect(() => {
    document.title = 'Settings | HOCKIA Admin'
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure admin portal preferences
        </p>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-blue-100">
            <Info className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-medium text-blue-900">Admin Access</h3>
            <p className="text-sm text-blue-700 mt-1">
              Admin access is controlled via <code className="bg-blue-100 px-1 rounded">app_metadata.is_admin</code> in Supabase.
              This must be set directly in the Supabase dashboard or via the Admin Actions Edge Function.
            </p>
          </div>
        </div>
      </div>

      {/* Settings sections */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">General</h2>
          </div>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              No configurable settings at this time. Admin portal settings will be added as needed.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Reference */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Reference</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-700">Grant Admin Access</h3>
            <p className="text-sm text-gray-500 mt-1">
              Use the Supabase Dashboard → Authentication → Users → Select User → Edit User → Add{' '}
              <code className="bg-gray-100 px-1 rounded">{`{"is_admin": true}`}</code> to app_metadata.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-700">Environment</h3>
            <p className="text-sm text-gray-500 mt-1">
              Current environment: <code className="bg-gray-100 px-1 rounded">{import.meta.env.MODE}</code>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-700">Admin Portal Version</h3>
            <p className="text-sm text-gray-500 mt-1">
              <code className="bg-gray-100 px-1 rounded">v1.0.0</code> - Initial release
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
