import { useState, useCallback, useRef, useEffect } from 'react'
import { chipTone } from '@/components/ui/chipClasses'
import { createPortal } from 'react-dom'
import { Loader2, Search, Shield, X, ImagePlus, CircleHelp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { identityLine, positionLabel } from '@/lib/identity'
import { useUserPosts, type PostImage } from '@/hooks/useUserPosts'
import { validateImage, optimizeImage } from '@/lib/imageOptimization'
import { useUploadManager } from '@/lib/uploadManager'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { checkContent } from '@/lib/contentFilter'
import { getDraft, saveDraft, clearDraft } from '@/lib/composerDraft'
import { pickPlaceholder, type ComposerRole } from '@/lib/composerPlaceholders'
import { Avatar, RoleBadge } from '@/components'
import { PostMediaUploader, type UploadedMedia } from './PostMediaUploader'
import { Chip } from '@/components/ui/Chip'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { NewSigningArt } from './v1/NewSigningArt'
import { signingDetail } from '@/lib/homeEngagement'
import { seasonLabel } from '@/lib/signing'
import type { HomeFeedItem, UserPostFeedItem, TransferMetadata, SigningMetadata } from '@/types/homeFeed'
import { useHomeT } from '@/i18n/ns/home'
import { countryLabel, placeText } from '@/i18n/countryNames'

interface PostComposerModalProps {
  isOpen: boolean
  onClose: () => void
  onPostCreated: (item: HomeFeedItem) => void
  editingPost?: { id: string; content: string; images: PostImage[] | null } | null
  /** Photos to attach as the composer opens ("Share on Home?" after a profile
   *  upload). Each goes through the normal post-image upload. New posts only. */
  initialImageFiles?: File[]
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
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
}

export function PostComposerModal({
  isOpen,
  onClose,
  onPostCreated,
  editingPost,
  initialImageFiles,
}: PostComposerModalProps) {
  const t = useHomeT()
  const { user, profile } = useAuthStore()
  const { createPost, createTransferPost, createSigningPost, updatePost } = useUserPosts()
  const isEdit = Boolean(editingPost)
  // Phone = the Figma component pass (Compose 101:823 / 272:648); desktop keeps the earlier controls.
  const isPhone = useMediaQuery('(max-width: 1023px)')
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
  // Rotating per-role placeholder picked once on modal open. Static within a
  // session so it doesn't shift while the user is typing.
  const [postPlaceholder, setPostPlaceholder] = useState<string>(() =>
    pickPlaceholder((profile?.role ?? null) as ComposerRole | null)
  )
  // True when the open-effect populated `content` from a saved draft (vs.
  // an empty start). Drives the "Draft restored — Discard" affordance.
  const [draftRestored, setDraftRestored] = useState(false)

  // Cloudflare video posts are launch-flagged server-side (app_settings
  // 'video_posts_enabled'; create_user_post rejects new video items while
  // off). Mirror the flag in the UI so the button never dead-ends. Fail-OPEN
  // here: if the RPC flakes we show the button and let the server refuse —
  // fail-closed would spuriously hide a live feature on a network blip.
  const [videoPostsEnabled, setVideoPostsEnabled] = useState(true)
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void supabase
      .rpc('video_posts_enabled')
      .then(({ data, error }) => {
        if (!cancelled && !error && typeof data === 'boolean') setVideoPostsEnabled(data)
      })
    return () => { cancelled = true }
  }, [isOpen])

  // Transfer mode state
  const [mode, setMode] = useState<'post' | 'transfer'>('post')
  // Post | Question chips (Figma Compose): switches the kind only — placeholder
  // and primary button change, everything else stays.
  const [kind, setKind] = useState<'post' | 'question'>('post')
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
  // Home v1 New signing (Figma H11b): the card's role and season lines.
  const [signingRole, setSigningRole] = useState('')
  const [signingSeason, setSigningSeason] = useState('')
  const personSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup search timeouts on unmount (uploads survive modal close via global store)
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      if (personSearchTimeoutRef.current) clearTimeout(personSearchTimeoutRef.current)
    }
  }, [])

  // Lock body scroll while the modal is open. Without this:
  //   - PullToRefresh listens at document level and fires refresh when
  //     the user drags down inside the modal (e.g. pulling the textarea
  //     out of view at scrollY 0)
  //   - On iOS Safari rubber-band overscroll bleeds through the backdrop
  // Save the previous overflow value so unmount restores rather than
  // overwriting state owned by a wrapping modal (mirrors Modal.tsx).
  // Use the position:fixed scroll-lock pattern so iOS WKWebView preserves
  // the feed scroll position when the composer closes.
  useBodyScrollLock(isOpen)

  // Add Escape-to-close so keyboard users / iPad with hardware keyboard
  // can dismiss without reaching the X button.
  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (e.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
      if (e.key === 'Escape' && !isSubmitting) handleCloseRef.current?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, isSubmitting])

  // handleClose is defined later (uses contentRef + isSubmitting). Hold a
  // forward ref so the Escape effect above can call the latest version
  // without depending on it (which would force re-binding the listener
  // every keystroke via the auto-save effect chain).
  const handleCloseRef = useRef<(() => void) | null>(null)

  // Tracks which mode was last loaded — referenced by the open-effect (to
  // sync to 'post' on each open) AND the mode-change effect (to know when
  // to flush + reload). Declared up here so both effects can see it.
  const lastModeRef = useRef<'post' | 'transfer'>('post')
  // Mirror of `content` for synchronous reads (close flush, mode-switch
  // flush) without making `content` a dependency of those effects/callbacks.
  const contentRef = useRef('')

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) return

    // Reroll the placeholder on each open so users see variety. Stays
    // stable within a single session of the modal.
    setPostPlaceholder(pickPlaceholder((profile?.role ?? null) as ComposerRole | null))

    if (editingPost) {
      setContent(editingPost.content)
      setDraftRestored(false)
      setMedia(
        editingPost.images
          ? editingPost.images.map((img, i) => ({
              url: img.url,
              // MUST carry video_id through — a Cloudflare reel has no url, so
              // dropping this silently destroys the video when a post is edited.
              video_id: (img as UploadedMedia).video_id,
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
      // Restore the 'post'-mode draft (the open-effect resets to 'post'
      // mode below). Reading from the live `mode` state here would pick
      // up whatever the user left the modal in last session — e.g.
      // 'transfer' — and load the wrong slot for a flash before the
      // mode-change effect corrects it.
      const restored = getDraft(user?.id, 'post')
      setContent(restored)
      setDraftRestored(restored.length > 0)
      setMedia([])
    }
    setError(null)
    setMode('post')
    setKind('post')
    // Keep lastModeRef in sync so the mode-change effect below doesn't
    // immediately re-fire (with stale mode === 'transfer' from prior
    // session) and clobber the post-mode draft we just loaded.
    lastModeRef.current = 'post'
    setSigningRole('')
    setSigningSeason('')
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
            video_id: entry.result!.videoId,
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
    // Intentionally NOT depending on mode/profile/user — this is the
    // open-once reset. Subsequent mode changes are handled by the
    // mode-change effect below; profile.role and user.id are stable for
    // the modal's lifetime so reading them inline is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingPost])

  // Reload draft when mode changes (Post ↔ Transfer). Each mode has its own
  // draft slot — switching tabs swaps in the right one. Skipped when
  // editing an existing post (the post's stored content is the source of
  // truth there) and on initial open (the open-effect above already
  // populated the draft for the default mode).
  //
  // contentRef mirrors `content` so the mode-change effect (and handleClose)
  // can read the latest typed text without depending on it (which would
  // make those effects/callbacks re-fire on every keystroke).
  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => {
    if (!isOpen || editingPost) return
    if (lastModeRef.current === mode) return
    // Flush whatever's currently typed to the OLD mode's slot before we
    // swap. The auto-save effect is debounced 500ms; without this, a rapid
    // tap on Transfer would lose any keystrokes typed in the last <500ms.
    saveDraft(user?.id, lastModeRef.current, contentRef.current)
    lastModeRef.current = mode
    setContent(getDraft(user?.id, mode))
    // Note: deliberately NOT touching draftRestored here. The chip's
    // purpose is "alert the user that pre-existing content was loaded
    // when they opened the modal" — once they've started mode-switching
    // they're already aware of the modal's contents, and resurfacing the
    // chip on toggle-back-to-post would falsely claim that content they
    // typed in this session was "restored from your last session."
  }, [mode, isOpen, editingPost, user?.id])

  // Auto-save the textarea content as a draft (debounced). Skipped when
  // editing an existing post.
  useEffect(() => {
    if (!isOpen || editingPost || !user?.id) return
    const handle = setTimeout(() => {
      saveDraft(user.id, mode, content)
    }, 500)
    return () => clearTimeout(handle)
  }, [content, isOpen, editingPost, user?.id, mode])

  // Synchronously flush the draft before closing — covers the X button and
  // backdrop tap. Without this, the 500ms debounce above can swallow the
  // user's last few keystrokes when they close immediately after typing.
  //
  // Skip the flush when:
  //   - editing an existing post (the stored post is the source of truth)
  //   - a submit is in flight (the success path already cleared the draft;
  //     re-saving here would resurrect the just-cleared content)
  //   - content is empty (nothing useful to save; avoids one extra write)
  const handleClose = useCallback(() => {
    if (!editingPost && user?.id && !isSubmitting && contentRef.current.length > 0) {
      saveDraft(user.id, mode, contentRef.current)
    }
    onClose()
  }, [editingPost, user?.id, mode, onClose, isSubmitting])

  // Keep handleCloseRef pointed at the latest handleClose so the Escape
  // effect above can call it without re-binding every render.
  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  // User-initiated draft discard. Clears the slot and the textarea; closes
  // the "Draft restored" chip.
  const handleDiscardDraft = useCallback(() => {
    clearDraft(user?.id, mode)
    setContent('')
    setDraftRestored(false)
  }, [user?.id, mode])

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
        setClubResults(Array.isArray(data) ? data as unknown as ClubSearchResult[] : [])
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
        setPersonResults(Array.isArray(data) ? data as PersonSearchResult[] : [])
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
      reportSupabaseError('composer.image_upload', err, {
        userId: user?.id,
      }, { feature: 'post_composer', upload_kind: 'post_image' })
      setError(err instanceof Error ? err.message : t('composer.errors.imageUpload'))
    } finally {
      setIsUploading(false)
    }
  }, [user, t])

  // "Share on Home?": attach the photos handed in, once per open, one at a
  // time so they keep their order. Runs after the open-effect cleared `media`.
  const seededFilesRef = useRef(false)
  useEffect(() => {
    if (!isOpen) { seededFilesRef.current = false; return }
    if (seededFilesRef.current || editingPost || !initialImageFiles?.length) return
    seededFilesRef.current = true
    void (async () => {
      for (const file of initialImageFiles.slice(0, 5)) await handleMediaAddImage(file)
    })()
  }, [isOpen, editingPost, initialImageFiles, handleMediaAddImage])

  const handleMediaAddVideo = useCallback((file: File) => {
    if (!user) return

    setIsUploading(true)
    setUploadProgress(0)
    setError(null)

    // Dispatch to global upload manager — survives modal close, tab switch, navigation.
    // The video goes to CLOUDFLARE as a Home video post (kind='post', its own
    // product concept — not a Gallery reel, not recruitment evidence); the post
    // stores only its video_id.
    const uploadId = useUploadManager.getState().startVideoUpload({
      file,
      onComplete: (result) => {
        setMedia((prev) => [
          ...prev,
          {
            video_id: result.videoId,
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
      reportSupabaseError('composer.logo_upload', err, {
        userId: user?.id,
      }, { feature: 'post_composer', upload_kind: 'club_logo' })
      setError(err instanceof Error ? err.message : t('composer.errors.logoUpload'))
    } finally {
      setIsUploadingLogo(false)
    }
  }, [user, t])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return

    // Transfer / Signing mode submit
    if (mode === 'transfer') {
      const role = profile?.role
      // Defense in depth: even if the toggle was bypassed (e.g. stale state
      // from a prior modal session, or a manual setMode call), block roles
      // that have no coherent transfer/signing semantics.
      if (role !== 'player' && role !== 'coach' && role !== 'club') {
        setError(t('composer.errors.transferRole'))
        return
      }
      const isClubRole = role === 'club'

      // Club signing flow
      if (isClubRole) {
        if (!selectedPerson) {
          setError(t('composer.errors.personRequired'))
          return
        }

        // Content filter on optional caption
        if (content.trim()) {
          const filterResult = checkContent(content.trim())
          if (!filterResult.allowed) { setError(filterResult.reason || t('composer.errors.blockedFallback')); return }
        }

        setIsSubmitting(true)
        setError(null)

        try {
          const postMedia = media.length > 0 ? media : null
          const result = await createSigningPost(
            selectedPerson.id,
            content.trim() || null,
            postMedia,
            { role: signingRole, season: signingSeason },
          )

          if (!result.success) {
            throw new Error(result.error || t('composer.errors.signingFailed'))
          }

          // Build optimistic feed item
          if (result.post_id && profile) {
            const signingMetadata: SigningMetadata = {
              person_name: selectedPerson.full_name,
              person_role: selectedPerson.role,
              person_avatar_url: selectedPerson.avatar_url,
              person_profile_id: selectedPerson.id,
              person_position: selectedPerson.position,
              club_name: profile.full_name,
              club_avatar_url: profile.avatar_url,
              signing_role: signingRole.trim() || null,
              season: signingSeason.trim() || null,
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
              comments_enabled: true,
              congrats_count: 0,
              has_congrats: false,
            }
            onPostCreated(newItem)
          }

          clearDraft(user?.id, mode)
          setContent('')
          setMedia([])
          onClose()
        } catch (err) {
          logger.error('[PostComposerModal] Signing submit error:', err)
          reportSupabaseError('composer.submit', err, {
            mode: 'transfer',
            isClubRole: true,
            authorRole: profile?.role,
            hasSelectedPerson: Boolean(selectedPerson),
            hasMedia: media.length > 0,
          }, { feature: 'post_composer', submit_mode: 'signing' })
          setError(err instanceof Error ? err.message : t('composer.errors.signingFailed'))
        } finally {
          setIsSubmitting(false)
        }
        return
      }

      // Player/Coach transfer flow (existing)
      const clubName = selectedClub ? selectedClub.name : customClubName.trim()
      if (!clubName) {
        setError(t('composer.errors.clubRequired'))
        return
      }

      // Content filter on optional caption
      if (content.trim()) {
        const filterResult = checkContent(content.trim())
        if (!filterResult.allowed) { setError(filterResult.reason || t('composer.errors.blockedFallback')); return }
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
          throw new Error(result.error || t('composer.errors.transferFailed'))
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
            author_role: profile.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire',
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

        clearDraft(user?.id, mode)
        setContent('')
        setMedia([])
        onClose()
      } catch (err) {
        logger.error('[PostComposerModal] Transfer submit error:', err)
        reportSupabaseError('composer.submit', err, {
          mode: 'transfer',
          isClubRole: false,
          authorRole: profile?.role,
          hasSelectedClub: Boolean(selectedClub),
          hasCustomClub: Boolean(customClubName),
          hasMedia: media.length > 0,
        }, { feature: 'post_composer', submit_mode: 'transfer' })
        setError(err instanceof Error ? err.message : t('composer.errors.transferFailed'))
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    // Regular post submit
    const trimmed = content.trim()

    // A post is valid with text OR media — a media-only post is allowed.
    if (!trimmed && media.length === 0) {
      setError(t('composer.errors.empty'))
      return
    }

    if (trimmed.length > MAX_CONTENT_LENGTH) {
      setError(t('composer.errors.tooLong', { max: MAX_CONTENT_LENGTH }))
      return
    }

    // Content filter — block objectionable text (Apple Guideline 1.2).
    // Skipped for media-only posts: there is no text to screen.
    if (trimmed) {
      const filterResult = checkContent(trimmed)
      if (!filterResult.allowed) {
        setError(filterResult.reason || t('composer.errors.blockedFallback'))
        return
      }
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const postMedia = media.length > 0 ? media : null

      if (isEdit && editingPost) {
        const result = await updatePost(editingPost.id, trimmed, postMedia)
        if (!result.success) {
          throw new Error(result.error || t('composer.errors.updateFailed'))
        }
      } else {
        const result = await createPost(trimmed, postMedia, kind === 'question' ? 'question' : 'text')
        if (!result.success) {
          throw new Error(result.error || t('composer.errors.createFailed'))
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
            author_role: profile.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire',
            content: trimmed,
            images: postMedia,
            like_count: 0,
            comment_count: 0,
            has_liked: false,
          }
          onPostCreated(newItem)
        }
      }

      // Only wipe the draft slot for the active mode on a successful CREATE.
      // For an edit, the user's separate post-mode draft is unrelated and
      // shouldn't be clobbered.
      if (!isEdit) clearDraft(user?.id, mode)
      setContent('')
      setMedia([])
      setDraftRestored(false)
      onClose()
    } catch (err) {
      logger.error('[PostComposerModal] Submit error:', err)
      reportSupabaseError('composer.submit', err, {
        mode: 'post',
        isEdit,
        authorRole: profile?.role,
        hasMedia: media.length > 0,
      }, { feature: 'post_composer', submit_mode: isEdit ? 'edit' : 'post' })
      setError(err instanceof Error ? err.message : t('composer.errors.saveFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }, [content, media, mode, selectedClub, selectedPerson, customClubName, clubLogoUrl, isEdit, editingPost, createPost, createTransferPost, createSigningPost, updatePost, profile, onPostCreated, onClose, isSubmitting, user?.id, kind, signingRole, signingSeason, t])

  if (!isOpen) return null

  // Determine submit eligibility
  const isClubRole = profile?.role === 'club'
  // Transfer / signing only makes domain sense for player, coach, club:
  //   - player / coach: announce their own transfer to a new club
  //   - club: announce a signing
  // Brands and umpires don't have a coherent transfer narrative — gating
  // here hides the toggle for them. Submit-side check below enforces it
  // even if the UI is bypassed.
  const canUseTransferMode = profile?.role === 'player'
    || profile?.role === 'coach'
    || profile?.role === 'club'
  const hasClub = selectedClub || customClubName.trim()
  const canSubmitTransfer = canUseTransferMode && (
    isClubRole
      ? Boolean(selectedPerson)
      : Boolean(hasClub) && !isUploadingLogo
  )
  // A post can be published with text OR at least one media attachment.
  const canSubmitPost = content.trim().length > 0 || media.length > 0
  const canSubmit = mode === 'transfer' ? canSubmitTransfer : canSubmitPost

  // Render through a portal so the modal's `position: fixed` is anchored to
  // the viewport, not to the nearest transformed ancestor. The PostComposer
  // collapsed bar that triggers this modal lives inside HomePage's sticky
  // header, which uses `translate-y-0` for its slide-up animation. Per CSS
  // spec, any non-`none` transform creates a containing block for fixed
  // descendants — without the portal, the modal (and its backdrop) only
  // covered the sticky header's bounds, leaving the rest of the page
  // visible underneath.
  if (typeof document === 'undefined') return null
  return createPortal(
    // z-[10000] lets the composer beat the cookie consent banner (z-[9999])
    // and other always-on-top UI. Before the portal, the modal was trapped
    // in the sticky parent's stacking context (z-40) and z-50 was relative
    // to that — irrelevant once we render at the root.
    <div className="fixed inset-0 z-[10000] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-0 sm:p-4">
        <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-composer-title"
          tabIndex={-1}
          className="relative flex min-h-[100dvh] w-full flex-col bg-white focus:outline-none sm:min-h-0 sm:max-h-[100dvh] sm:max-w-lg sm:overflow-y-auto sm:rounded-2xl sm:shadow-xl"
        >
          {/* Nav (Figma Compose): Cancel on the left, the one primary pill on
              the right — Post / Ask / Save / Announce. */}
          <div className="sticky top-0 z-10 flex h-11 items-center justify-between bg-white px-5 pt-[env(safe-area-inset-top)]">
            <h2 id="post-composer-title" className="sr-only">
              {isEdit ? t('composer.title.edit') : mode === 'transfer' ? (isClubRole ? t('composer.title.signing') : t('composer.title.transfer')) : kind === 'question' ? t('composer.title.question') : t('composer.title.post')}
            </h2>
            {isPhone ? (
              <>
                {/* Figma Compose 101:823: Tertiary "Cancel", Primary Small "Post" / "Ask". */}
                <button type="button" onClick={handleClose} className={buttonClassName({ variant: 'tertiary', size: 'small', radius: 'rounded-full', className: '-ml-3.5' })} aria-label={t('composer.cancel')} data-testid="composer-cancel">
                  {t('composer.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || isUploading || isUploadingLogo || !canSubmit}
                  aria-label={isEdit ? t('composer.submitAria.save') : mode === 'transfer' ? t('composer.submitAria.announce') : kind === 'question' ? t('composer.submitAria.ask') : t('composer.submitAria.publish')}
                  className={buttonClassName({ variant: 'primary', size: 'small', radius: 'rounded-full', className: 'px-4' })}
                  data-testid="composer-submit"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEdit ? t('composer.submit.save') : mode === 'transfer' && !isClubRole ? t('composer.submit.announce') : kind === 'question' && mode === 'post' ? t('composer.submit.ask') : t('composer.submit.post')}
                </button>
              </>
            ) : (
              <>
            <button type="button" onClick={handleClose} className="-ml-1 min-h-[44px] pr-3 text-body text-hockia-primary" aria-label={t('composer.cancel')}>
              {t('composer.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isUploading || isUploadingLogo || !canSubmit}
              aria-label={isEdit ? t('composer.submitAria.save') : mode === 'transfer' ? t('composer.submitAria.announce') : kind === 'question' ? t('composer.submitAria.ask') : t('composer.submitAria.publish')}
              className="flex h-[34px] items-center gap-1.5 rounded-full bg-hockia-primary px-4 text-row font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? t('composer.submit.save') : mode === 'transfer' ? t('composer.submit.announce') : kind === 'question' ? t('composer.submit.ask') : t('composer.submit.post')}
            </button>
              </>
            )}
          </div>

          {/* Content. Bottom padding uses max(env(safe-area-inset-bottom),
              1.5rem) so the Submit button never sits beneath the iPhone
              home indicator on a full-height modal. */}
          <div className="p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] space-y-4">
            {/* Author info */}
            {profile && (
              <div className="flex items-center gap-3">
                <Avatar
                  src={profile.avatar_url}
                  initials={profile.full_name?.slice(0, 2) || '?'}
                  size="md"
                  role={profile.role}
                />
                <div>
                  <p className="text-row font-semibold text-ink-1">{profile.full_name}</p>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-secondary">
                    <span className="text-ink-2">{identityLine(profile.role)}</span>{' '}
                    <span className="text-ink-3">{t('composer.audience')}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Post | Question | Transfer chips (Figma "post type"). Post and
                Question share the free-text form and differ only in placeholder
                and button; Transfer / New signing switches to the announcement
                form. Questions are public by design so coaches and clubs can answer. */}
            {!isEdit && (
              <div className="flex gap-2" role="radiogroup" aria-label={t('composer.kind.groupAria')}>
                {/* Transfers are career events, not posts (founder 2026-09-20):
                    the milestone reaches the feed from Career entry. The
                    transfer/signing form stays in the code but is never offered. */}
                {(isClubRole
                  // Clubs post New signings (Figma H11b; ruling 11 Oct: only clubs).
                  ? ([['post', t('composer.kind.post')], ['question', t('composer.kind.question')], ['signing', t('composer.kind.signing')]] as const)
                  : ([['post', t('composer.kind.post')], ['question', t('composer.kind.question')]] as const)
                ).map(([value, label]) => {
                  const active = value === 'signing' ? mode === 'transfer' : mode === 'post' && kind === value
                  const select = () => {
                    setError(null)
                    if (value === 'signing') { setMode('transfer'); return }
                    setMode('post')
                    setKind(value)
                  }
                  if (isPhone) {
                    // Post | Question = Chips (selected soft purple).
                    return (
                      <Chip
                        key={value}
                        label={label}
                        selected={active}
                        role="radio"
                        aria-checked={active}
                        aria-pressed={undefined}
                        onClick={select}
                      />
                    )
                  }
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={select}
                      className={`flex h-[30px] items-center gap-1.5 rounded-full px-3 text-secondary font-semibold transition-colors ${chipTone(active)}`}
                    >
                      {value === 'question' && <CircleHelp className="h-3.5 w-3.5" strokeWidth={2} />}
                      {label}
                    </button>
                  )
                })}
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
                          placeholder={t('composer.signing.personSearch')}
                          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C]/30 focus:border-[#EA580C]"
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
                                role={person.role}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-900 truncate">{person.full_name}</p>
                                  <RoleBadge role={person.role} />
                                </div>
                                <p className="text-xs text-gray-500 truncate">
                                  {[positionLabel(person.position), person.current_club, placeText(person.base_location)].filter(Boolean).join(', ')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No results state */}
                      {personSearch.trim().length >= 2 && !isSearchingPeople && personResults.length === 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                          <p className="text-sm text-gray-500 text-center">{t('composer.signing.personEmpty')}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Figma H11b: the tagged member, Role, Season, then the card as it
                    will appear. Tagging is 18+ (search + a server guard). */}
                {selectedPerson && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedPerson(null)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-surface-muted px-3.5 py-2.5 text-left"
                      aria-label={t('composer.signing.taggedAria', { name: selectedPerson.full_name })}
                    >
                      <Avatar src={selectedPerson.avatar_url} initials={selectedPerson.full_name?.slice(0, 2) || '?'} size="sm" role={selectedPerson.role} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-micro font-semibold uppercase text-ink-3">{t('composer.signing.personLabel')}</span>
                        <span className="block truncate text-body text-ink-1">{selectedPerson.full_name}</span>
                      </span>
                      <X className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                    </button>
                    <label className="block rounded-2xl bg-surface-muted px-3.5 py-2.5">
                      <span className="block text-micro font-semibold uppercase text-ink-3">{t('composer.signing.roleLabel')}</span>
                      <input
                        value={signingRole}
                        onChange={(e) => setSigningRole(e.target.value.slice(0, 60))}
                        placeholder={[positionLabel(selectedPerson.position), t('composer.signing.rolePlaceholder')].filter(Boolean).join(', ')}
                        className="w-full bg-transparent text-body text-ink-1 placeholder:text-ink-4 focus:outline-none"
                      />
                    </label>
                    <label className="block rounded-2xl bg-surface-muted px-3.5 py-2.5">
                      <span className="block text-micro font-semibold uppercase text-ink-3">{t('composer.signing.seasonLabel')}</span>
                      <input
                        value={signingSeason}
                        onChange={(e) => setSigningSeason(e.target.value.slice(0, 20))}
                        placeholder={seasonLabel(null)}
                        className="w-full bg-transparent text-body text-ink-1 placeholder:text-ink-4 focus:outline-none"
                      />
                    </label>
                    <p className="pt-1.5 text-micro font-semibold uppercase text-ink-3">{t('composer.signing.preview')}</p>
                    <NewSigningArt
                      personName={selectedPerson.full_name}
                      personAvatarUrl={selectedPerson.avatar_url}
                      clubName={profile?.full_name ?? t('composer.signing.clubFallback')}
                      clubCrestUrl={profile?.avatar_url ?? null}
                      detail={signingDetail({ signing_role: signingRole, person_position: selectedPerson.position, season: signingSeason })}
                    />
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
                          placeholder={t('composer.transfer.clubSearch')}
                          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30 focus:border-hockia-primary"
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
                                  <span className="text-xs text-gray-500">{countryLabel(club.country_name)}</span>
                                </div>
                              </div>
                              {club.is_claimed && (
                                <span className="text-[10px] font-medium text-hockia-primary bg-hockia-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                  {t('composer.transfer.onHockia')}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No results state */}
                      {clubSearch.trim().length >= 2 && !isSearching && clubResults.length === 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                          <p className="text-sm text-gray-500 text-center">{t('composer.transfer.clubEmpty')}</p>
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
                      className="text-sm text-hockia-primary hover:text-hockia-secondary font-medium"
                    >
                      {t('composer.transfer.enterManually')}
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
                        <span className="text-xs text-gray-500">{countryLabel(selectedClub.country_name)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedClub(null)}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      aria-label={t('composer.transfer.removeClub')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Unknown club form */}
                {showUnknownClub && !selectedClub && (
                  <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">{t('composer.transfer.manualTitle')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnknownClub(false)
                          setCustomClubName('')
                          setClubLogoUrl(null)
                        }}
                        className="text-xs text-hockia-primary hover:text-hockia-secondary font-medium"
                      >
                        {t('composer.transfer.backToSearch')}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customClubName}
                      onChange={(e) => setCustomClubName(e.target.value)}
                      placeholder={t('composer.transfer.clubName')}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30 focus:border-hockia-primary"
                    />

                    {/* Logo upload */}
                    <div className="flex items-center gap-3">
                      {clubLogoUrl ? (
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
                            <img src={clubLogoUrl} alt={t('composer.transfer.logoAlt')} className="w-full h-full object-cover" />
                          </div>
                          <button
                            type="button"
                            onClick={() => setClubLogoUrl(null)}
                            className="absolute -top-1 -right-1 p-0.5 bg-red-500 rounded-full text-white"
                            aria-label={t('composer.transfer.removeLogo')}
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
                          <span>{t('composer.transfer.addLogo')}</span>
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
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

            {/* Draft-restored chip — only when content was loaded from a
                saved draft, not for fresh-open or edit-existing-post. */}
            {draftRestored && !editingPost && mode === 'post' && content.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 bg-surface-grouped border border-line rounded-lg text-xs text-ink-2">
                <span>{t('composer.draft.restored')}</span>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="font-medium underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary rounded"
                >
                  {t('composer.draft.discard')}
                </button>
              </div>
            )}

            {/* Textarea — not on a club's New signing (H11b: the card is the post). */}
            <div className={mode === 'transfer' && isClubRole ? 'hidden' : undefined}>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleContentChange}
                placeholder={
                  mode === 'transfer'
                    ? (isClubRole
                        ? t('composer.placeholder.signing')
                        : t('composer.placeholder.transfer'))
                    // Default ('post') mode uses the per-role rotating
                    // placeholder. Umpire prompts in that pool already
                    // stick to credentials / federation / aggregates, per
                    // officials' professional norms (NASO, TASO).
                    : kind === 'question' ? t('composer.placeholder.question') : postPlaceholder
                }
                rows={mode === 'transfer' ? 3 : 4}
                maxLength={MAX_CONTENT_LENGTH}
                autoCapitalize="sentences"
                spellCheck
                className={`w-full px-0 py-2 text-ink-1 placeholder:text-ink-3 border-0 focus:outline-none focus-visible:ring-0 resize-none ${mode === 'transfer' ? 'text-base' : 'text-[20px] leading-[26px]'}`}
                style={{ minHeight: mode === 'transfer' ? '60px' : '100px' }}
              />
              {/* Remaining count only inside the last 50 characters, lightest ink. */}
              {MAX_CONTENT_LENGTH - content.length <= 50 && (
                <div className="flex justify-end">
                  <span className="text-caption tabular-nums text-ink-3">{MAX_CONTENT_LENGTH - content.length}</span>
                </div>
              )}
            </div>

            {/* Media uploader (images + video). Video is a REGULAR-POST
                feature only: announcement cards (transfer/signing) cannot
                play video and their RPCs reject Cloudflare video items — so
                in transfer mode the button never appears. Also hidden while
                the video_posts_enabled launch flag is off. */}
            {!(mode === 'transfer' && isClubRole) && (
            <PostMediaUploader
              media={media}
              onAddImage={handleMediaAddImage}
              onAddVideo={handleMediaAddVideo}
              onRemove={handleMediaRemove}
              onCancelUpload={handleCancelUpload}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              maxItems={5}
              allowVideo={mode !== 'transfer' && videoPostsEnabled}
              quiet={isPhone}
            />
            )}

            {/* Submit — the nav pill is the primary control on the phone; this
                full-width button stays for announcements and wide screens. */}
            {((mode === 'transfer' && !(isClubRole && isPhone)) || isEdit) && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isUploading || isUploadingLogo || !canSubmit}
              className="w-full py-2.5 px-4 bg-hockia-primary text-white rounded-full font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting
                ? (mode === 'transfer' ? t('composer.footer.announcing') : t('composer.footer.posting'))
                : isEdit
                  ? t('composer.footer.save')
                  : mode === 'transfer'
                    ? (isClubRole ? t('composer.footer.announceSigning') : t('composer.footer.announceTransfer'))
                    // "Publish post" — distinct from the "Post" mode tab
                    // above so the dialog has no two same-named controls.
                    // (Avoids "Share post", which is already the share-
                    // sheet heading elsewhere.)
                    : t('composer.footer.publish')
              }
            </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
