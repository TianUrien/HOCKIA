import { useState, useEffect, useRef } from 'react'
import { Check, Loader2, Shield, UserMinus, UserPlus, UserX, Clock, ChevronDown } from 'lucide-react'
import { useFriendship } from '@/hooks/useFriendship'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface FriendshipButtonProps {
  profileId: string
  className?: string
}

export default function FriendshipButton({ profileId, className }: FriendshipButtonProps) {
  const { addToast } = useToastStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const {
    loading,
    mutating,
    isAuthenticated,
    isOwnProfile,
    isFriend,
    isIncomingRequest,
    isOutgoingRequest,
    status,
    sendRequest,
    acceptRequest,
    rejectRequest,
    cancelRequest,
    removeFriend,
  } = useFriendship(profileId)

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  if (isOwnProfile) return null

  const handleAuthRequired = () => {
    addToast('Sign in with your HOCKIA profile to manage connections.', 'error')
  }

  const handleAction = async (action: () => Promise<void>) => {
    setMenuOpen(false)
    await action()
  }

  // Loading state
  if (loading) {
    return (
      <button
        type="button"
        disabled
        className={cn('inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600', className)}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking...
      </button>
    )
  }

  // Unauthenticated state
  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={handleAuthRequired}
        className={cn('inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50', className)}
      >
        <UserPlus className="h-4 w-4" />
        Add Friend
      </button>
    )
  }

  // Blocked state
  if (status === 'blocked') {
    return (
      <span className={cn('inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700', className)}>
        <Shield className="h-4 w-4" />
        Blocked
      </span>
    )
  }

  // Incoming request state - show Accept/Decline buttons
  if (isIncomingRequest) {
    return (
      <div className={cn('flex flex-wrap gap-2', className)}>
        <button
          type="button"
          disabled={mutating}
          onClick={() => void acceptRequest()}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Accept
        </button>
        <button
          type="button"
          disabled={mutating}
          onClick={() => void rejectRequest()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
          Decline
        </button>
      </div>
    )
  }

  // Determine button state and styling
  const getButtonConfig = () => {
    if (isFriend) {
      return {
        label: 'Friends',
        icon: <Check className="h-4 w-4" />,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        hasDropdown: true,
      }
    }

    if (isOutgoingRequest) {
      return {
        label: 'Request Sent',
        icon: <Clock className="h-4 w-4" />,
        className: 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100',
        hasDropdown: true,
      }
    }

    // Default: no relationship
    return {
      label: 'Add Friend',
      icon: <UserPlus className="h-4 w-4" />,
      className: 'bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white shadow-sm hover:opacity-90',
      hasDropdown: false,
    }
  }

  const config = getButtonConfig()

  // No dropdown needed - just show the action button
  if (!config.hasDropdown) {
    return (
      <button
        type="button"
        disabled={mutating}
        onClick={() => void sendRequest()}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-60',
          config.className,
          className
        )}
      >
        {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : config.icon}
        {config.label}
      </button>
    )
  }

  // Dropdown menu for Friends and Request Sent states
  return (
    <div className={cn('relative', className)} ref={menuRef}>
      <button
        type="button"
        disabled={mutating}
        onClick={() => setMenuOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-60',
          config.className
        )}
      >
        {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : config.icon}
        {config.label}
        <ChevronDown className={cn('h-4 w-4 transition-transform', menuOpen && 'rotate-180')} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-gray-100 bg-white p-1.5 shadow-lg ring-1 ring-black/5">
          {isFriend && (
            <button
              type="button"
              onClick={() => void handleAction(removeFriend)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <UserMinus className="h-4 w-4" />
              Remove Friend
            </button>
          )}

          {isOutgoingRequest && (
            <button
              type="button"
              onClick={() => void handleAction(cancelRequest)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <UserX className="h-4 w-4" />
              Cancel Request
            </button>
          )}
        </div>
      )}
    </div>
  )
}
