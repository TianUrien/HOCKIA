import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import TrustedReferenceCard from './TrustedReferenceCard'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface PublicReferencesSectionProps {
  profileId: string
  profileName?: string | null
}

export default function PublicReferencesSection({ profileId, profileName }: PublicReferencesSectionProps) {
  const { acceptedReferences, loading } = useTrustedReferences(profileId)
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const primaryName = profileName?.split(' ')[0]?.trim() || null

  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1)

    // Track active card index based on scroll position
    const cards = container.children
    if (cards.length === 0) return
    const containerLeft = container.scrollLeft
    const containerCenter = containerLeft + container.clientWidth / 2
    let closestIdx = 0
    let closestDist = Infinity
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i] as HTMLElement
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const dist = Math.abs(cardCenter - containerCenter)
      if (dist < closestDist) {
        closestDist = dist
        closestIdx = i
      }
    }
    setActiveIndex(closestIdx)
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    // Initial check after layout
    const timer = setTimeout(updateScrollState, 100)
    return () => clearTimeout(timer)
  }, [acceptedReferences.length, loading, updateScrollState])

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current
    if (!container) return
    const scrollAmount = 356
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  if (!profileId) return null

  const handleMessage = async (targetId: string | null) => {
    if (!targetId) return

    if (!user) {
      addToast('Sign in to message HOCKIA members.', 'info')
      navigate('/')
      return
    }

    setMessageTarget(targetId)
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${targetId}),and(participant_one_id.eq.${targetId},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()

      if (error) throw error

      if (data?.id) {
        navigate(`/messages?conversation=${data.id}`)
      } else {
        navigate(`/messages?new=${targetId}`)
      }
    } catch (error) {
      logger.error('Failed to open messages', error)
      addToast('Unable to start conversation. Please try again.', 'error')
    } finally {
      setMessageTarget(null)
    }
  }

  const renderSkeleton = () => (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div
          key={idx}
          className="min-w-[300px] flex-shrink-0 rounded-2xl border border-gray-100 bg-white/80 p-4 shadow-sm animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/2 rounded bg-gray-200" />
              <div className="h-3 w-1/3 rounded bg-gray-200" />
            </div>
          </div>
          <div className="mt-4 h-3 w-3/4 rounded bg-gray-100" />
          <div className="mt-2 h-3 w-full rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )

  const renderEmpty = () => (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white/80 p-6 text-center">
      <p className="text-sm text-gray-600">
        {primaryName ? `${primaryName} hasn't published any trusted references yet.` : 'No trusted references yet.'}
      </p>
    </div>
  )

  const renderReferences = () => (
    <div className="relative">
      {/* Scroll buttons - hidden on mobile, visible on desktop when scrollable */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll('left')}
          className="absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-gray-200 bg-white p-2 shadow-lg transition hover:bg-gray-50 md:flex"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll('right')}
          className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-gray-200 bg-white p-2 shadow-lg transition hover:bg-gray-50 md:flex"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-5 w-5 text-gray-600" />
        </button>
      )}

      {/* Horizontal scrollable container */}
      <div
        ref={scrollContainerRef}
        onScroll={updateScrollState}
        className={cn(
          'flex gap-4 overflow-x-auto pb-2 scrollbar-hide',
          'snap-x snap-mandatory scroll-smooth',
          '-mx-1 px-1 scroll-pl-1' // Edge peek with scroll padding
        )}
      >
        {acceptedReferences.map((reference) => (
          <TrustedReferenceCard
            key={reference.id}
            reference={reference}
            layout="carousel"
            onMessage={handleMessage}
            messageLoading={messageTarget === reference.profile?.id}
            className="snap-center"
            onOpenProfile={(id, role) => {
              if (!id) return
              if (role === 'club') {
                navigate(`/clubs/id/${id}`)
              } else if (role === 'umpire') {
                navigate(`/umpires/id/${id}`)
              } else {
                navigate(`/players/id/${id}`)
              }
            }}
          />
        ))}
      </div>

      {/* Scroll indicator dots for mobile */}
      {acceptedReferences.length > 1 && (
        <div className="mt-3 flex justify-center gap-2 md:hidden">
          {acceptedReferences.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Go to card ${idx + 1}`}
              onClick={() => {
                const container = scrollContainerRef.current
                const card = container?.children[idx] as HTMLElement | undefined
                if (container && card) {
                  container.scrollTo({ left: card.offsetLeft - 4, behavior: 'smooth' })
                }
              }}
              className={cn(
                'rounded-full transition-all duration-200',
                idx === activeIndex
                  ? 'h-2 w-5 bg-emerald-500'
                  : 'h-2 w-2 bg-gray-300'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm sm:p-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Trusted References</p>
        <h3 className="text-xl font-bold text-gray-900">Trusted by</h3>
        <p className="text-sm text-gray-600">{primaryName ? `Key people who vouch for ${primaryName}.` : 'Key people who vouch for this profile.'}</p>
      </header>

      {loading ? renderSkeleton() : acceptedReferences.length === 0 ? renderEmpty() : renderReferences()}
    </section>
  )
}
