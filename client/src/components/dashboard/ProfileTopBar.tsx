import { useCallback, useState } from 'react'
import { Check, Share } from 'lucide-react'
import SettingsSheet from '@/components/SettingsSheet'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * Mobile title row of the Profile screen (UI redesign 2026-09-19):
 *
 *   Profile                                   [share]  [settings]
 *
 * Settings moved here from the app header (founder ruling); Share hands the
 * member's public profile link to the system share sheet, or copies it
 * where sharing isn't available. Hidden on desktop, where the header's
 * avatar menu already carries Settings.
 */
function publicProfileUrl(role: string | null | undefined, id: string, username: string | null | undefined): string | null {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (role === 'brand') return null
  const base = role === 'club' ? '/clubs' : role === 'umpire' ? '/umpires' : role === 'coach' ? '/coaches' : '/players'
  return `${origin}${base}/${username ? username : `id/${id}`}`
}

export default function ProfileTopBar({ title = 'Profile' }: { title?: string }) {
  const profile = useAuthStore((s) => s.profile)
  const [copied, setCopied] = useState(false)
  const url = profile ? publicProfileUrl(profile.role, profile.id, profile.username) : null

  const share = useCallback(async () => {
    if (!url) return
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: profile?.full_name ?? 'HOCKIA profile', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      // A dismissed share sheet rejects with AbortError — not a failure.
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[ProfileTopBar] share failed', err)
    }
  }, [url, profile?.full_name])

  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-1 lg:hidden" data-testid="profile-top-bar">
      <h1 className="text-[22px] font-bold leading-7 text-gray-900">{title}</h1>
      <div className="-mr-2 flex items-center">
        {url && (
          <button
            type="button"
            onClick={() => void share()}
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-gray-900 transition-colors hover:bg-gray-100"
            aria-label={copied ? 'Link copied' : 'Share your profile'}
          >
            {copied ? <Check className="h-[22px] w-[22px] text-emerald-600" strokeWidth={1.75} /> : <Share className="h-[22px] w-[22px]" strokeWidth={1.75} />}
          </button>
        )}
        <SettingsSheet className="!rounded-full !text-gray-900" />
      </div>
    </div>
  )
}
