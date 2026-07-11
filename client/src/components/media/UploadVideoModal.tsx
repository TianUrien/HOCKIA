import { useState, useEffect, useRef, useId } from 'react'
import { X, UploadCloud, Loader2, CheckCircle2, AlertCircle, Film } from 'lucide-react'
import Button from '../Button'
import Input from '../Input'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useNativeVideoUpload } from '@/hooks/useNativeVideoUpload'

/**
 * UploadVideoModal — native highlight-video upload (Cloudflare Stream).
 * Pick a file → title/description/visibility → upload with progress →
 * "processing" while Cloudflare transcodes → success. Calls onUploaded
 * with the new videoId so the parent can refresh its list.
 */
interface UploadVideoModalProps {
  isOpen: boolean
  onClose: () => void
  onUploaded: (videoId: string) => void
  kind?: 'highlight' | 'full_match'
}

export default function UploadVideoModal({ isOpen, onClose, onUploaded, kind = 'highlight' }: UploadVideoModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'recruiters'>('public')
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  const { phase, progress, error, upload, cancel, reset } = useNativeVideoUpload()
  const busy = phase === 'creating' || phase === 'uploading' || phase === 'processing'

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  useEffect(() => {
    if (isOpen) {
      setFile(null); setTitle(''); setDescription(''); setVisibility('public'); reset()
    }
  }, [isOpen, reset])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, busy, onClose])

  // Fire onUploaded + close once ready.
  useEffect(() => {
    if (phase === 'ready') {
      // small beat so the user sees the success state
      const t = setTimeout(() => {
        onClose()
      }, 900)
      return () => clearTimeout(t)
    }
  }, [phase, onClose])

  if (!isOpen) return null

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120))
  }

  const handleSubmit = async () => {
    if (!file || !title.trim() || busy) return
    const id = await upload(file, { title: title.trim(), description: description.trim() || undefined, visibility, kind })
    if (id && phase !== 'error') onUploaded(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Film className="h-5 w-5 text-hockia-primary" />
            Upload highlight video
          </h2>
          <button
            type="button"
            onClick={() => { if (busy) cancel(); onClose() }}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {phase === 'ready' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="font-semibold text-gray-900">Video uploaded!</p>
              <p className="text-sm text-gray-500">It's ready on your profile.</p>
            </div>
          ) : phase === 'processing' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-hockia-primary" />
              <p className="font-semibold text-gray-900">Processing your video…</p>
              <p className="text-sm text-gray-500">Cloudflare is preparing it for smooth playback. This can take a minute or two — you can keep using HOCKIA.</p>
            </div>
          ) : phase === 'uploading' || phase === 'creating' ? (
            <div className="py-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">
                  {phase === 'creating' ? 'Starting upload…' : 'Uploading…'}
                </span>
                <span className="tabular-nums text-gray-500">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gradient-to-r from-hockia-primary to-hockia-secondary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <button type="button" onClick={() => { cancel(); reset() }} className="mt-3 text-xs text-gray-500 hover:text-gray-700 hover:underline">
                Cancel
              </button>
            </div>
          ) : (
            <>
              {/* File picker */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-8 text-center transition-colors hover:border-hockia-primary/50 hover:bg-hockia-primary/[0.02]"
              >
                <UploadCloud className="h-8 w-8 text-hockia-primary" />
                <span className="text-sm font-semibold text-gray-900">
                  {file ? file.name : 'Choose a video file'}
                </span>
                <span className="text-xs text-gray-500">MP4, MOV, WebM · up to 1 GB · up to 10 min</span>
              </button>
              <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" className="hidden" onChange={onPickFile} />

              <div>
                <label htmlFor="video-title" className="mb-1 block text-sm font-medium text-gray-700">Title</label>
                <Input id="video-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="e.g. 2026 Season Highlights" />
              </div>

              <div>
                <label htmlFor="video-desc" className="mb-1 block text-sm font-medium text-gray-700">Description <span className="text-gray-400">(optional)</span></label>
                <textarea
                  id="video-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hockia-primary focus:outline-none focus:ring-1 focus:ring-hockia-primary"
                  placeholder="A few words about this video"
                />
              </div>

              <div>
                <span className="mb-1 block text-sm font-medium text-gray-700">Who can watch</span>
                <div className="grid grid-cols-2 gap-2">
                  {([['public', 'Everyone'], ['recruiters', 'Recruiters only']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setVisibility(val)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        visibility === val
                          ? 'border-hockia-primary bg-hockia-primary/5 text-hockia-primary'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {visibility === 'recruiters'
                    ? 'Only clubs and coaches will be able to play this video.'
                    : 'Anyone viewing your profile can play this video.'}
                </p>
              </div>

              {(error || phase === 'error') && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error ?? 'Something went wrong. Please try again.'}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={!file || !title.trim()}>Upload</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
