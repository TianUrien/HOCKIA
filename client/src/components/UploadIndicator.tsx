import { useEffect, useState, useCallback } from 'react'
import { X, Pause, Play, CheckCircle, AlertCircle, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import { useUploadManager, type UploadEntry } from '@/lib/uploadManager'

export default function UploadIndicator() {
  const uploads = useUploadManager((s) => s.uploads)
  const cancelUpload = useUploadManager((s) => s.cancelUpload)
  const pauseUpload = useUploadManager((s) => s.pauseUpload)
  const resumeUpload = useUploadManager((s) => s.resumeUpload)
  const dismissUpload = useUploadManager((s) => s.dismissUpload)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const visible = Object.values(uploads).filter(
    (u) =>
      u.status === 'validating' ||
      u.status === 'uploading' ||
      u.status === 'paused' ||
      u.status === 'error' ||
      u.status === 'completed',
  )

  // Auto-dismiss completed uploads after 5 seconds
  useEffect(() => {
    const completed = visible.filter((u) => u.status === 'completed')
    if (completed.length === 0) return
    const timers = completed.map((u) => setTimeout(() => dismissUpload(u.id), 5000))
    return () => timers.forEach(clearTimeout)
  }, [visible, dismissUpload])

  if (visible.length === 0) return null

  const hasActive = visible.some((u) => u.status === 'uploading' || u.status === 'validating')
  const hasPaused = visible.some((u) => u.status === 'paused')
  const hasError = visible.some((u) => u.status === 'error')

  const statusLabel = hasActive
    ? 'Uploading...'
    : hasPaused
      ? 'Upload paused'
      : hasError
        ? 'Upload failed'
        : 'Upload complete'

  return (
    <div className="fixed bottom-20 right-4 md:bottom-4 z-[90] w-80 max-w-[calc(100vw-2rem)]">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Upload className="w-4 h-4 text-hockia-primary" />
            <span>{statusLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed((p) => !p)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
            aria-label={isCollapsed ? 'Expand upload details' : 'Collapse upload details'}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Entries */}
        {!isCollapsed && (
          <div className="divide-y divide-gray-100">
            {visible.map((entry) => (
              <UploadRow
                key={entry.id}
                entry={entry}
                onCancel={() => cancelUpload(entry.id)}
                onPause={() => pauseUpload(entry.id)}
                onResume={() => resumeUpload(entry.id)}
                onDismiss={() => dismissUpload(entry.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function UploadRow({
  entry,
  onCancel,
  onPause,
  onResume,
  onDismiss,
}: {
  entry: UploadEntry
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  onDismiss: () => void
}) {
  const isActive = entry.status === 'uploading' || entry.status === 'validating'

  const handleAction = useCallback(() => {
    if (entry.status === 'uploading') onPause()
    else if (entry.status === 'paused') onResume()
  }, [entry.status, onPause, onResume])

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-700 truncate max-w-[180px]" title={entry.fileName}>
          {entry.fileName}
        </span>
        <div className="flex items-center gap-1">
          {/* Pause / Resume toggle */}
          {(entry.status === 'uploading' || entry.status === 'paused') && (
            <button
              type="button"
              onClick={handleAction}
              className="p-1 text-gray-400 hover:text-hockia-primary rounded"
              aria-label={entry.status === 'uploading' ? 'Pause upload' : 'Resume upload'}
            >
              {entry.status === 'uploading' ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Cancel or Dismiss */}
          <button
            type="button"
            onClick={isActive || entry.status === 'paused' ? onCancel : onDismiss}
            className="p-1 text-gray-400 hover:text-red-500 rounded"
            aria-label={isActive || entry.status === 'paused' ? 'Cancel upload' : 'Dismiss'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || entry.status === 'paused') && (
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              entry.status === 'paused' ? 'bg-amber-400' : 'bg-hockia-primary'
            }`}
            style={{ width: `${entry.progress}%` }}
          />
        </div>
      )}

      {/* Status label */}
      <div className="mt-1 flex items-center gap-1.5">
        {entry.status === 'validating' && (
          <span className="text-xs text-gray-500">Checking video...</span>
        )}
        {entry.status === 'uploading' && (
          <span className="text-xs text-gray-500">{entry.progress}% uploaded</span>
        )}
        {entry.status === 'paused' && (
          <span className="text-xs text-amber-600">Paused at {entry.progress}%</span>
        )}
        {entry.status === 'completed' && (
          <>
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-green-600">Upload complete</span>
          </>
        )}
        {entry.status === 'error' && (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-xs text-red-600 truncate">{entry.error || 'Upload failed'}</span>
          </>
        )}
      </div>
    </div>
  )
}
