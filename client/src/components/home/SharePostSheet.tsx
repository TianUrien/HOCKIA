/**
 * SharePostSheet — "One share sheet for the whole app" (Figma 03 Player,
 * Share 115:727). Friends first: the people you already talk to, one tap
 * each; then the system options — Copy link, WhatsApp, Instagram, More.
 */

import { useState, useCallback, useEffect } from 'react'
import { Send, Link2, Check, Instagram, MessageCircle, Share } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { extractErrorMessage } from '@/lib/utils'
import { sendSharedPostMessage } from '@/lib/sharePost'
import { getShareOrigin } from '@/lib/profileShare'
import { identityLine } from '@/lib/identity'
import { logger } from '@/lib/logger'
import type { SharedPostMetadata } from '@/types/chat'

interface ContactResult {
  id: string
  full_name: string
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
}

interface SharePostSheetProps {
  isOpen: boolean
  onClose: () => void
  postId: string
  authorId: string
  authorName: string | null
  authorAvatar: string | null
  authorRole: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  content: string
  thumbnailUrl: string | null
}

const RECENT_LIMIT = 6

export function SharePostSheet({
  isOpen,
  onClose,
  postId,
  authorId,
  authorName,
  authorAvatar,
  authorRole,
  content,
  thumbnailUrl,
}: SharePostSheetProps) {
  const { user, profile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)

  const [recentContacts, setRecentContacts] = useState<ContactResult[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(true)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())

  const isBrand = profile?.role === 'brand'
  const url = `${getShareOrigin()}/post/${postId}`
  const shareText = content ? content.slice(0, 120) : `${authorName ?? 'A member'} on HOCKIA`

  // The people you already talk to (same list as Inbox › Messages).
  useEffect(() => {
    if (!isOpen || !user?.id || isBrand) return
    let cancelled = false
    const fetchRecentContacts = async () => {
      setIsLoadingRecent(true)
      try {
        const { data, error } = await supabase.rpc('get_user_conversations', { p_user_id: user.id })
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC return type not generated
        const contacts: ContactResult[] = ((data || []) as any[])
          .slice(0, RECENT_LIMIT)
          .map((conv: { other_participant_id: string; other_participant_name: string; other_participant_avatar: string | null; other_participant_role: string }) => ({
            id: conv.other_participant_id,
            full_name: conv.other_participant_name,
            avatar_url: conv.other_participant_avatar,
            role: conv.other_participant_role as ContactResult['role'],
          }))
        if (!cancelled) setRecentContacts(contacts)
      } catch (err) {
        logger.error('[SharePostSheet] Error fetching recent contacts:', err)
      } finally {
        if (!cancelled) setIsLoadingRecent(false)
      }
    }
    void fetchRecentContacts()
    return () => { cancelled = true }
  }, [isOpen, user?.id, isBrand])

  const handleSendTo = useCallback(
    async (contact: ContactResult) => {
      if (!user?.id || sendingTo || sentTo.has(contact.id)) return
      setSendingTo(contact.id)
      try {
        const postData: SharedPostMetadata = {
          type: 'shared_post',
          post_id: postId,
          author_id: authorId,
          author_name: authorName,
          author_avatar: authorAvatar,
          author_role: authorRole,
          content_preview: content.slice(0, 150),
          thumbnail_url: thumbnailUrl,
        }
        const result = await sendSharedPostMessage(user.id, contact.id, postData)
        if (result.success) {
          setSentTo((prev) => new Set(prev).add(contact.id))
          addToast(`Sent to ${contact.full_name}`, 'success')
        } else {
          addToast(result.error || 'Failed to send post', 'error')
        }
      } catch (error) {
        addToast(extractErrorMessage(error, 'Failed to share post. Please try again.'), 'error')
      } finally {
        setSendingTo(null)
      }
    },
    [user?.id, sendingTo, sentTo, postId, authorId, authorName, authorAvatar, authorRole, content, thumbnailUrl, addToast],
  )

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    addToast('Link copied', 'success')
  }, [url, addToast])

  const handleSystemShare = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'HOCKIA', text: shareText, url })
      } else {
        await handleCopyLink()
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not open the share menu', 'error')
    }
  }, [shareText, url, handleCopyLink, addToast])

  const handleWhatsApp = useCallback(() => {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`, '_blank', 'noopener')
  }, [shareText, url])

  const handleClose = () => {
    setSentTo(new Set())
    onClose()
  }

  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const systemOption = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className="flex w-14 flex-col items-center gap-1.5 text-caption text-ink-2">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-grouped text-ink-1">{icon}</span>
      {label}
    </button>
  )

  return (
    <BottomSheet open={isOpen} onClose={handleClose} ariaLabel="Share this post">
      <div className="flex flex-col gap-4 px-5 pb-3 pt-1">
        <h2 className="text-title text-ink-1">Share this post</h2>

        {/* What is being shared */}
        <div className="flex items-center gap-3 rounded-card bg-surface-grouped px-3 py-2.5">
          <EntityAvatar src={authorAvatar} name={authorName} role={authorRole} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-row font-semibold text-ink-1">{authorName ?? 'HOCKIA member'}</p>
            <p className="truncate text-secondary text-ink-2">{content ? content : identityLine(authorRole)}</p>
          </div>
        </div>

        {!isBrand && (recentContacts.length > 0 || isLoadingRecent) && (
          <div>
            <p className="pb-2 text-secondary font-semibold text-ink-2">Send to a friend</p>
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
              {isLoadingRecent
                ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[52px] w-[52px] shrink-0 animate-pulse rounded-full bg-surface-grouped" />)
                : recentContacts.map((contact) => {
                    const sent = sentTo.has(contact.id)
                    const sending = sendingTo === contact.id
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => void handleSendTo(contact)}
                        disabled={sending || sent}
                        aria-label={sent ? `Sent to ${contact.full_name}` : `Send to ${contact.full_name}`}
                        className="flex w-[52px] shrink-0 flex-col items-center gap-1.5"
                      >
                        <span className="relative">
                          <EntityAvatar src={contact.avatar_url} name={contact.full_name} role={contact.role} size={52} />
                          <span className={`absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white ${sent ? 'bg-positive text-white' : 'bg-hockia-primary text-white'}`}>
                            {sending ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : sent ? <Check className="h-3 w-3" strokeWidth={3} /> : <Send className="h-2.5 w-2.5" strokeWidth={2.5} />}
                          </span>
                        </span>
                        <span className="w-full truncate text-center text-caption text-ink-2">{contact.full_name.split(' ')[0]}</span>
                      </button>
                    )
                  })}
            </div>
          </div>
        )}

        <div className="border-t border-line" />

        <div className="flex gap-3 pb-1">
          {systemOption('Copy link', <Link2 className="h-5 w-5" strokeWidth={1.8} />, () => void handleCopyLink())}
          {systemOption('WhatsApp', <MessageCircle className="h-5 w-5" strokeWidth={1.8} />, handleWhatsApp)}
          {canSystemShare && systemOption('Instagram', <Instagram className="h-5 w-5" strokeWidth={1.8} />, () => void handleSystemShare())}
          {canSystemShare && systemOption('More', <Share className="h-5 w-5" strokeWidth={1.8} />, () => void handleSystemShare())}
        </div>
      </div>
    </BottomSheet>
  )
}
