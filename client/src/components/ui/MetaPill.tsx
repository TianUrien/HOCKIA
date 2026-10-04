import type { ReactNode } from 'react'
import { Shield, Sparkles, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Tag / Meta (Figma "03 · Components" 582:7949): an identity fact under a
 * name — club (Shield), position (Target), specialist (Sparkles). 13
 * semibold, 6 / 8 padding, fully round. Neutral = subtle grey surface with
 * ink text; Brand = soft brand with brand text. Not tappable by itself; wrap
 * it in a button when the fact links somewhere (the club pill).
 */
export type MetaPillTone = 'neutral' | 'brand'
export type MetaPillIcon = 'club' | 'position' | 'specialist'

const ICONS = { club: Shield, position: Target, specialist: Sparkles } as const

interface MetaPillProps {
  tone?: MetaPillTone
  icon?: MetaPillIcon
  children: ReactNode
  className?: string
}

export function MetaPill({ tone = 'neutral', icon, children, className }: MetaPillProps) {
  const Icon = icon ? ICONS[icon] : null
  return (
    <span
      data-tone={tone}
      data-icon={icon}
      data-testid="meta-pill"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1.5 text-secondary font-semibold',
        tone === 'brand' ? 'bg-brand-soft text-brand-primary' : 'bg-surface-subtle text-ink-1',
        className,
      )}
    >
      {Icon && <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  )
}
