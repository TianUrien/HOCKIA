import { useState } from 'react'
import { Camera } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { Avatar } from '@/components'
import { PostComposerModal } from './PostComposerModal'
import type { HomeFeedItem } from '@/types/homeFeed'

interface PostComposerProps {
  onPostCreated: (item: HomeFeedItem) => void
}

/**
 * The resting composer strip (Figma Home v2 "composer"): 36px avatar, a
 * quiet "What's new?" prompt, a camera. Flat on the page — the Compose
 * screen is where the writing happens.
 */
export function PostComposer({ onPostCreated }: PostComposerProps) {
  const { user, profile } = useAuthStore()
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (!user || !profile) return null

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-2" data-testid="post-composer">
        <Avatar
          src={profile.avatar_url}
          initials={profile.full_name?.slice(0, 2) || '?'}
          size="md"
          className="!h-9 !w-9 flex-shrink-0"
          role={profile.role}
        />
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="min-h-[44px] flex-1 text-left text-row text-ink-4 transition-colors hover:text-ink-3"
        >
          What&apos;s new?
        </button>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-muted"
          aria-label="Add a photo or video"
        >
          <Camera className="h-6 w-6" strokeWidth={1.8} />
        </button>
      </div>

      <PostComposerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPostCreated={onPostCreated}
      />
    </>
  )
}
