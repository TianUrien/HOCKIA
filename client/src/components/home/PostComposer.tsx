import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { Avatar } from '@/components'
import { PostComposerModal } from './PostComposerModal'
import type { HomeFeedItem } from '@/types/homeFeed'

interface PostComposerProps {
  onPostCreated: (item: HomeFeedItem) => void
}

export function PostComposer({ onPostCreated }: PostComposerProps) {
  const { user, profile } = useAuthStore()
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (!user || !profile) return null

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <Avatar
            src={profile.avatar_url}
            initials={profile.full_name?.slice(0, 2) || '?'}
            size="md"
            className="flex-shrink-0"
            role={profile.role}
          />
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex-1 text-left px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full text-gray-500 text-sm hover:bg-gray-100 transition-colors"
          >
            Start a post...
          </button>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-gray-50 rounded-lg transition-colors"
            aria-label="Add image"
          >
            <ImagePlus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <PostComposerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPostCreated={onPostCreated}
      />
    </>
  )
}
