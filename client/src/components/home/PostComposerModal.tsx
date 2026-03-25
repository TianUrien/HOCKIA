import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, Search, Shield, X, ImagePlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useUserPosts, type PostImage } from '@/hooks/useUserPosts'
import { validateImage, optimizeImage } from '@/lib/imageOptimization'
import { useUploadManager } from '@/lib/uploadManager'
import { logger } from '@/lib/logger'
import { checkContent } from '@/lib/contentFilter'
import { Avatar, RoleBadge } from '@/components'
import { PostMediaUploader, type UploadedMedia } from './PostMediaUploader'
import type { HomeFeedItem, UserPostFeedItem, TransferMetadata, SigningMetadata } from '@/types/homeFeed'

interface PostComposerModalProps {
  isOpen: boolean
  onClose: () => void
  onPostCreated: (item: HomeFeedItem) => void
  editingPost?: { id: string; content: string; images: PostImage[] | null } | null
}

interface ClubSearchResult {
  id: string
  name: string
  country_id: number
  country_code: string
  country_name: string
  flag_emoji: string
  avatar_url: string | null
  is_claimed: boolean
  claimed_profile_id: string | null
}

interface PersonSearchResult {
  id: string
  full_name: string
  avatar_url: string | null
  role: 'player' | 'coach'
  position: string | null
  current_club: string | null
  base_location: string | null
}

const MAX_CONTENT_LENGTH = 2000
const BUCKET = 'user-posts'

function getFlagUrl(countryCode: string): string {
  if (countryCode.toUpperCase() === 'XE') {
    return 'https://flagcdn.com/w40/gb-eng.png'
  }
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
}

export function PostComposerModal({
  isOpen,
  onClose,
  onPostCreated,
  editingPost,
}: PostComposerModalProps) {
  const { user, profile } = useAuthStore()
  const { createPost, createTransferPost, createSigningPost, updatePost } = useUserPosts()
  const isEdit = Boolean(editingPost)
  const dialogRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  // Common state
  const [content, setContent] = useState('')
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Transfer mode state
  const [mode, setMode] = useState<'post' | 'transfer'>('post')
  const [clubSearch, setClubSearch] = useState('')
  const [clubResults, setClubResults] = useState<ClubSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedClub, setSelectedClub] = useState<ClubSearchResult | null>(null)
  const [showUnknownClub, setShowUnknownClub] = useState(false)
  const [customClubName, setCustomClubName] = useState('')
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)

  // Signing mode state (club role)
  const [personSearch, setPersonSearch] = useState('')
  const [personResults, setPersonResults] = useState<PersonSearchResult[]>([])
  const [isSearchingPeople, setIsSearchingPeople] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchResult | null>(null)
  const personSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup search timeouts on unmount (uploads survive modal close via global store)
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      if (personSearchTimeoutRef.current) clearTimeout(personSearchTimeoutRef.current)
    }
  }, [])

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) return

    if (editingPost) {
      setContent(editingPost.content)
      setMedia(
        editingPost.images
          ? editingPost.images.map((img, i) => ({
              url: img.url,
              thumb_url: (img as UploadedMedia).thumb_url ?? null,
              media_type: (img as UploadedMedia).media_type ?? 'image',
              width: (img as UploadedMedia).width ?? null,
              height: (img as UploadedMedia).height ?? null,
              duration: (img as UploadedMedia).duration ?? null,
              order: i,
            }))
          : []
      )
    } else {
      setContent('')
      setMedia([])
    }
    setError(null)
    setMode('post')
    setClubSearch('')
    setClubResults([])
    setSelectedClub(null)
    setShowUnknownClub(false)
    setCustomClubName('')
    setClubLogoUrl(null)
    setPersonSearch('')
    setPersonResults([])
    setSelectedPerson(null)

    // Consume any uploads that completed while modal was closed
    const { uploads, dismissUpload } = useUploadManager.getState()
    for (const entry of Object.values(uploads)) {
      if (entry.status === 'completed' && entry.result) {
        setMedia((prev) => [
          ...prev,
          {
            url: entry.result!.videoUrl,
            thumb_url: entry.result!.thumbUrl,
            media_type: 'video' as const,
            width: entry.result!.width,
            height: entry.result!.height,
            duration: entry.result!.duration,
            order: prev.length,
          },
        ])
        dismissUpload(entry.id)
      }
    }

    // Auto-focus textarea
    setTimeout(() => textareaRef.current?.focus(), 100)
  }, [isOpen, editingPost])

  // Debounced club search
  const handleClubSearch = useCallback((query: string) => {
    setClubSearch(query)
    setError(null)

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (query.trim().length < 2) {
      setClubResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
         
        const { data, error: rpcError } = await supabase.rpc(
          'search_clubs_for_transfer',
          { p_query: query.trim(), p_limit: 8 }
        )
        if (rpcError) throw rpcError
        setClubResults(Array.isArray(data) ? data : [])
      } catch (err) {
        logger.error('[PostComposerModal] Club search error:', err)
        setClubResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
  }, [])

  // Debounced person search (for club signing flow)
  const handlePersonSearch = useCallback((query: string) => {
    setPersonSearch(query)
    setError(null)

    if (personSearchTimeoutRef.current) {
      clearTimeout(personSearchTimeoutRef.current)
    }

    if (query.trim().length < 2) {
      setPersonResults([])
      setIsSearchingPeople(false)
      return
    }

    setIsSearchingPeople(true)
    personSearchTimeoutRef.current = setTimeout(async () => {
      try {
         
        const { data, error: rpcError } = await supabase.rpc(
          'search_people_for_signing',
          { p_query: query.trim(), p_limit: 8 }
        )
        if (rpcError) throw rpcError
        setPersonResults(Array.isArray(data) ? data : [])
      } catch (err) {
        logger.error('[PostComposerModal] Person search error:', err)
        setPersonResults([])
      } finally {
        setIsSearchingPeople(false)
      }
    }, 300)
  }, [])

  // Auto-resize textarea
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    setError(null)

    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [])

  const handleMediaAddImage = useCallback(async (file: File) => {
    if (!user) return

    setIsUploading(true)
    setError(null)

    try {
      const validation = validateImage(file, { maxFileSizeMB: 10 })
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      const optimized = await optimizeImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        maxSizeMB: 1,
        quality: 0.85,
      })

      const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
      const random = Math.random().toString(36).slice(2, 8)
      const fileName = `${user.id}/${Date.now()}_${random}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, optimized, {
          contentType: optimized.type,
          upsert: false,
          cacheControl: '31536000',
        })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(fileName)

      setMedia(prev => [...prev, {
        url: urlData.publicUrl,
        media_type: 'image' as const,
        order: prev.length,
      }])
    } catch (err) {
      logger.error('[PostComposerModal] Image upload error:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }, [user])

  const handleMediaAddVideo = useCallback((file: File) => {
    if (!user) return

    setIsUploading(true)
    setUploadProgress(0)
    setError(null)

    // Dispatch to global upload manager — survives modal close, tab switch, navigation
    const uploadId = useUploadManager.getState().startVideoUpload({
      file,
      userId: user.id,
      onComplete: (result) => {
        setMedia((prev) => [
          ...prev,
          {
            url: result.videoUrl,
            thumb_url: result.thumbUrl,
            media_type: 'video' as const,
            width: result.width,
            height: result.height,
            duration: result.duration,
            order: prev.length,
          },
        ])
        setIsUploading(false)
        setUploadProgress(null)
      },
    })

    // Mirror store progress into local state while modal is open
    const unsubscribe = useUploadManager.subscribe((state) => {
      const entry = state.uploads[uploadId]
      if (!entry) {
        unsubscribe()
        return
      }
      setUploadProgress(entry.progress)
      if (entry.status === 'error') {
        setError(entry.error)
        setIsUploading(false)
        setUploadProgress(null)
        unsubscribe()
      }
      if (entry.status === 'cancelled' || entry.status === 'completed') {
        setIsUploading(false)
        setUploadProgress(null)
        unsubscribe()
      }
    })
  }, [user])

  const handleCancelUpload = useCallback(() => {
    const { uploads, cancelUpload } = useUploadManager.getState()
    for (const entry of Object.values(uploads)) {
      if (entry.status === 'uploading' || entry.status === 'validating' || entry.status === 'paused') {
        cancelUpload(entry.id)
      }
    }
  }, [])

  const handleMediaRemove = useCallback((index: number) => {
    setMedia(prev => prev
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, order: i }))
    )
  }, [])

  // Club logo upload (for unknown clubs)
  const handleLogoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    e.target.value = ''

    setIsUploadingLogo(true)
    setError(null)

    try {
      const validation = validateImage(file, { maxFileSizeMB: 5 })
      if (!validation.valid) throw new Error(validation.error)

      const optimized = await optimizeImage(file, {
        maxWidth: 400,
        maxHeight: 400,
        maxSizeMB: 0.5,
        quality: 0.85,
      })

      const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
      const random = Math.random().toString(36).slice(2, 8)
      const fileName = `${user.id}/club-logo_${Date.now()}_${random}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, optimized, { contentType: optimized.type, upsert: false })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
      setClubLogoUrl(urlData.publicUrl)
    } catch (err) {
      logger.error('[PostComposerModal] Logo upload error:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload club logo')
    } finally {
      setIsUploadingLogo(false)
    }
  }, [user])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return

    // Transfer / Signing mode submit
    if (mode === 'transfer') {
      const isClubRole = profile?.role === 'club'

      // Club signing flow
      if (isClubRole) {
        if (!selectedPerson) {
          setError('Please select a player or coach')
          return
        }

        // Content filter on optional caption
        if (content.trim()) {
          const filterResult = checkContent(content.trim())
          if (!filterResult.allowed) { setError(filterResult.reason || 'Content violates community guidelines.'); return }
        }

        setIsSubmitting(true)
        setError(null)

        try {
          const postMedia = media.length > 0 ? media : null
          const result = await createSigningPost(
            selectedPerson.id,
            content.trim() || null,
            postMedia
          )

          if (!result.success) {
            throw new Error(result.error || 'Failed to create signing post')
          }

          // Build optimistic feed item
          if (result.post_id && profile) {
            const signingMetadata: SigningMetadata = {
              person_name: selectedPerson.full_name,
              person_role: selectedPerson.role,
              person_avatar_url: selectedPerson.avatar_url,
              person_profile_id: selectedPerson.id,
              person_position: selectedPerson.position,
            }

            const newItem: UserPostFeedItem = {
              feed_item_id: result.post_id,
              item_type: 'user_post',
              created_at: new Date().toISOString(),
              post_id: result.post_id,
              author_id: profile.id,
              author_name: profile.full_name,
              author_avatar: profile.avatar_url,
              author_role: 'club',
              content: content.trim() || `Welcome ${selectedPerson.full_name} to ${profile.full_name}!`,
              images: postMedia,
              like_count: 0,
              comment_count: 0,
              has_liked: false,
              post_type: 'signing',
              metadata: signingMetadata,
            }
            onPostCreated(newItem)
          }

          setContent('')
          setMedia([])
          onClose()
        } catch (err) {
          logger.error('[PostComposerModal] Signing submit error:', err)
          setError(err instanceof Error ? err.message : 'Failed to create signing post')
        } finally {
          setIsSubmitting(false)
        }
        return
      }

      // Player/Coach transfer flow (existing)
      const clubName = selectedClub ? selectedClub.name : customClubName.trim()
      if (!clubName) {
        setError('Please select or enter a club name')
        return
      }

      // Content filter on optional caption
      if (content.trim()) {
        const filterResult = checkContent(content.trim())
        if (!filterResult.allowed) { setError(filterResult.reason || 'Content violates community guidelines.'); return }
      }

      setIsSubmitting(true)
      setError(null)

      try {
        const postMedia = media.length > 0 ? media : null
        const result = await createTransferPost(
          clubName,
          selectedClub?.country_id ?? null,
          selectedClub?.id ?? null,
          selectedClub ? selectedClub.avatar_url : clubLogoUrl,
          content.trim() || null,
          postMedia
        )

        if (!result.success) {
          throw new Error(result.error || 'Failed to create transfer post')
        }

        // Build optimistic feed item
        if (result.post_id && profile) {
          const transferMetadata: TransferMetadata = {
            club_name: clubName,
            club_country_id: selectedClub?.country_id ?? null,
            club_country_code: selectedClub?.country_code ?? null,
            club_country_name: selectedClub?.country_name ?? null,
            club_avatar_url: selectedClub ? selectedClub.avatar_url : clubLogoUrl,
            world_club_id: selectedClub?.id ?? null,
            club_profile_id: selectedClub?.claimed_profile_id ?? null,
            is_known_club: Boolean(selectedClub),
          }

          const newItem: UserPostFeedItem = {
            feed_item_id: result.post_id,
            item_type: 'user_post',
            created_at: new Date().toISOString(),
            post_id: result.post_id,
            author_id: profile.id,
            author_name: profile.full_name,
            author_avatar: profile.avatar_url,
            author_role: profile.role as 'player' | 'coach' | 'club' | 'brand',
            content: content.trim() || `Joined ${clubName}!`,
            images: postMedia,
            like_count: 0,
            comment_count: 0,
            has_liked: false,
            post_type: 'transfer',
            metadata: transferMetadata,
          }
          onPostCreated(newItem)
        }

        setContent('')
        setMedia([])
        onClose()
      } catch (err) {
        logger.error('[PostComposerModal] Transfer submit error:', err)
        setError(err instanceof Error ? err.message : 'Failed to create transfer post')
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    // Regular post submit
    const trimmed = content.trim()

    if (!trimmed) {
      setError('Post content is required')
      return
    }

    if (trimmed.length > MAX_CONTENT_LENGTH) {
      setError(`Content exceeds ${MAX_CONTENT_LENGTH} character limit`)
      return
    }

    // Content filter — block objectionable text (Apple Guideline 1.2)
    const filterResult = checkContent(trimmed)
    if (!filterResult.allowed) {
      setError(filterResult.reason || 'Content violates community guidelines.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const postMedia = media.length > 0 ? media : null

      if (isEdit && editingPost) {
        const result = await updatePost(editingPost.id, trimmed, postMedia)
        if (!result.success) {
          throw new Error(result.error || 'Failed to update post')
        }
      } else {
        const result = await createPost(trimmed, postMedia)
        if (!result.success) {
          throw new Error(result.error || 'Failed to create post')
        }

        if (result.post_id && profile) {
          const newItem: UserPostFeedItem = {
            feed_item_id: result.post_id,
            item_type: 'user_post',
            created_at: new Date().toISOString(),
            post_id: result.post_id,
            author_id: profile.id,
            author_name: profile.full_name,
            author_avatar: profile.avatar_url,
            author_role: profile.role as 'player' | 'coach' | 'club' | 'brand',
            content: trimmed,
            images: postMedia,
            like_count: 0,
            comment_count: 0,
            has_liked: false,
          }
          onPostCreated(newItem)
        }
      }

      setContent('')
      setMedia([])
      onClose()
    } catch (err) {
      logger.error('[PostComposerModal] Submit error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save post')
    } finally {
      setIsSubmitting(false)
    }
  }, [content, media, mode, selectedClub, selectedPerson, customClubName, clubLogoUrl, isEdit, editingPost, createPost, createTransferPost, createSigningPost, updatePost, profile, onPostCreated, onClose, isSubmitting])

  if (!isOpen) return null

  // Determine submit eligibility
  const isClubRole = profile?.role === 'club'
  const hasClub = selectedClub || customClubName.trim()
  const canSubmitTransfer = isClubRole
    ? Boolean(selectedPerson)
    : Boolean(hasClub) && !isUploadingLogo
  const canSubmitPost = content.trim().length > 0
  const canSubmit = mode === 'transfer' ? canSubmitTransfer : canSubmitPost

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-composer-title"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto focus:outline-none"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <h2 id="post-composer-title" className="text-xl font-semibold text-gray-900">
              {isEdit ? 'Edit Post' : mode === 'transfer' ? (isClubRole ? 'Announce New Signing' : 'Announce Transfer') : 'Create Post'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Author info */}
            {profile && (
              <div className="flex items-center gap-3">
                <Avatar
                  src={profile.avatar_url}
                  initials={profile.full_name?.slice(0, 2) || '?'}
                  size="md"
                />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{profile.full_name}</p>
                  <p className="text-xs text-gray-500 capitalize">{profile.role}</p>
                </div>
              </div>
            )}

            {/* Mode toggle — hidden when editing */}
            {!isEdit && (
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setMode('post')}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                    mode === 'post'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Post
                </button>
                <button
                  type="button"
                  onClick={() => setMode('transfer')}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                    mode === 'transfer'
                      ? 'bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {isClubRole ? 'New Signing' : 'Transfer'}
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Signing: Person selection (club role) */}
            {mode === 'transfer' && !isEdit && isClubRole && (
              <div className="space-y-3">
                {!selectedPerson && (
                  <>
                    {/* Person search */}
                    <div className="relative">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="search"
                          value={personSearch}
                          onChange={(e) => handlePersonSearch(e.target.value)}
                          placeholder="Search for a player or coach..."
                          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EA580C]/30 focus:border-[#EA580C]"
                          autoComplete="off"
                          enterKeyHint="search"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        {isSearchingPeople && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                        )}
                      </div>

                      {/* Search results dropdown */}
                      {personResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {personResults.map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              onClick={() => {
                                setSelectedPerson(person)
                                setPersonSearch('')
                                setPersonResults([])
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                            >
                              <Avatar
                                src={person.avatar_url}
                                initials={person.full_name?.slice(0, 2) || '?'}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-900 truncate">{person.full_name}</p>
                                  <RoleBadge role={person.role} />
                                </div>
                                <p className="text-xs text-gray-500 truncate">
                                  {[person.position, person.current_club, person.base_location].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No results state */}
                      {personSearch.trim().length >= 2 && !isSearchingPeople && personResults.length === 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                          <p className="text-sm text-gray-500 text-center">No players or coaches found</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Selected person display */}
                {selectedPerson && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <Avatar
                      src={selectedPerson.avatar_url}
                      initials={selectedPerson.full_name?.slice(0, 2) || '?'}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{selectedPerson.full_name}</p>
                        <RoleBadge role={selectedPerson.role} />
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {[selectedPerson.position, selectedPerson.current_club].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedPerson(null)}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      aria-label="Remove selected person"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Transfer: Club selection (player/coach role) */}
            {mode === 'transfer' && !isEdit && !isClubRole && (
              <div className="space-y-3">
                {!selectedClub && !showUnknownClub && (
                  <>
                    {/* Club search */}
                    <div className="relative">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="search"
                          value={clubSearch}
                          onChange={(e) => handleClubSearch(e.target.value)}
                          placeholder="Search for a club..."
                          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA]"
                          autoComplete="off"
                          enterKeyHint="search"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        {isSearching && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                        )}
                      </div>

                      {/* Search results dropdown */}
                      {clubResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {clubResults.map((club) => (
                            <button
                              key={club.id}
                              type="button"
                              onClick={() => {
                                setSelectedClub(club)
                                setClubSearch('')
                                setClubResults([])
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                            >
                              <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {club.avatar_url ? (
                                  <img src={club.avatar_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Shield className="w-4 h-4 text-gray-400" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">{club.name}</p>
                                <div className="flex items-center gap-1">
                                  <img
                                    src={getFlagUrl(club.country_code)}
                                    alt=""
                                    className="w-3.5 h-2.5 object-cover rounded-sm"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                  />
                                  <span className="text-xs text-gray-500">{club.country_name}</span>
                                </div>
                              </div>
                              {club.is_claimed && (
                                <span className="text-[10px] font-medium text-[#8026FA] bg-[#8026FA]/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                  On HOCKIA
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No results state */}
                      {clubSearch.trim().length >= 2 && !isSearching && clubResults.length === 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                          <p className="text-sm text-gray-500 text-center">No clubs found</p>
                        </div>
                      )}
                    </div>

                    {/* Club not listed link */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowUnknownClub(true)
                        setClubSearch('')
                        setClubResults([])
                      }}
                      className="text-sm text-[#8026FA] hover:text-[#924CEC] font-medium"
                    >
                      Club not listed? Enter manually
                    </button>
                  </>
                )}

                {/* Selected club display */}
                {selectedClub && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {selectedClub.avatar_url ? (
                        <img src={selectedClub.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Shield className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{selectedClub.name}</p>
                      <div className="flex items-center gap-1">
                        <img
                          src={getFlagUrl(selectedClub.country_code)}
                          alt=""
                          className="w-3.5 h-2.5 object-cover rounded-sm"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <span className="text-xs text-gray-500">{selectedClub.country_name}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedClub(null)}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      aria-label="Remove selected club"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Unknown club form */}
                {showUnknownClub && !selectedClub && (
                  <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">Enter club details</p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnknownClub(false)
                          setCustomClubName('')
                          setClubLogoUrl(null)
                        }}
                        className="text-xs text-[#8026FA] hover:text-[#924CEC] font-medium"
                      >
                        Back to search
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customClubName}
                      onChange={(e) => setCustomClubName(e.target.value)}
                      placeholder="Club name"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA]"
                    />

                    {/* Logo upload */}
                    <div className="flex items-center gap-3">
                      {clubLogoUrl ? (
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
                            <img src={clubLogoUrl} alt="Club logo" className="w-full h-full object-cover" />
                          </div>
                          <button
                            type="button"
                            onClick={() => setClubLogoUrl(null)}
                            className="absolute -top-1 -right-1 p-0.5 bg-red-500 rounded-full text-white"
                            aria-label="Remove club logo"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
                          {isUploadingLogo ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ImagePlus className="w-4 h-4" />
                          )}
                          <span>Add club logo (optional)</span>
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png"
                            onChange={handleLogoUpload}
                            className="hidden"
                            disabled={isUploadingLogo}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Textarea */}
            <div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleContentChange}
                placeholder={mode === 'transfer' ? (isClubRole ? 'Share something about this signing... (optional)' : 'Share something about your transfer... (optional)') : "What's on your mind?"}
                rows={mode === 'transfer' ? 3 : 4}
                maxLength={MAX_CONTENT_LENGTH}
                autoCapitalize="sentences"
                spellCheck
                className="w-full px-0 py-2 text-gray-900 text-base placeholder-gray-400 border-0 focus:outline-none focus:ring-0 resize-none"
                style={{ minHeight: mode === 'transfer' ? '60px' : '100px' }}
              />
              <div className="flex justify-end">
                <span className={`text-xs ${content.length > MAX_CONTENT_LENGTH - 200 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {content.length}/{MAX_CONTENT_LENGTH}
                </span>
              </div>
            </div>

            {/* Media uploader (images + video) */}
            <PostMediaUploader
              media={media}
              onAddImage={handleMediaAddImage}
              onAddVideo={handleMediaAddVideo}
              onRemove={handleMediaRemove}
              onCancelUpload={handleCancelUpload}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              maxItems={5}
            />

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isUploading || isUploadingLogo || !canSubmit}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting
                ? (mode === 'transfer' ? 'Announcing...' : 'Posting...')
                : isEdit
                  ? 'Save Changes'
                  : mode === 'transfer'
                    ? (isClubRole ? 'Announce Signing' : 'Announce Transfer')
                    : 'Post'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
