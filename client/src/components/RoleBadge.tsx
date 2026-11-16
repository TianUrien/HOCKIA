import { cn } from '@/lib/utils'
import i18n from '@/i18n'
import { useEnumsT } from '@/i18n/ns/enums'

type RoleBadgeProps = {
  // All 5 HOCKIA roles explicitly listed so callers narrow correctly. The
  // `string | null` fallback keeps backward compatibility with code paths
  // that pass already-normalised role strings of unknown provenance.
  role?: 'player' | 'coach' | 'club' | 'brand' | 'umpire' | string | null
  className?: string
}

// Figma "Hockia / Color" role/* tokens (tokens.js → tailwind `role` colours).
// The rendered values are the ones the badge always had; roleBadge.test.tsx
// pins them so a token re-export cannot silently recolour the badges.
const roleStyles: Record<string, string> = {
  player: 'bg-role-player-bg text-role-player-ink',
  coach: 'bg-role-coach-bg text-role-coach-ink',
  club: 'bg-role-club-bg text-role-club-ink',
  brand: 'bg-role-brand-bg text-role-brand-ink',
  umpire: 'bg-surface-muted text-ink-2', // ink (Foundations) — neutral like an umpire's kit, never amber
}

const formatRoleLabel = (value: string) => {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function RoleBadge({ role, className }: RoleBadgeProps) {
  const t = useEnumsT()
  if (!role) return null

  const normalizedRole = role.trim().toLowerCase()
  const baseClass = roleStyles[normalizedRole] ?? 'bg-gray-100 text-gray-600'
  // The catalog's word for a known role; any other string keeps its own text.
  const key = `role.${normalizedRole}`
  const label = /^[a-z]+$/.test(normalizedRole) && i18n.exists(key, { ns: 'enums' })
    ? t(key as never) as string
    : formatRoleLabel(normalizedRole)
  if (!label) return null

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium', baseClass, className)}>
      {label}
    </span>
  )
}
