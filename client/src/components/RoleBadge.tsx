import { cn } from '@/lib/utils'

type RoleBadgeProps = {
  role?: 'player' | 'coach' | 'club' | string | null
  className?: string
}

const roleStyles: Record<string, string> = {
  player: 'bg-[#EFF6FF] text-[#2563EB]',
  coach: 'bg-[#F0FDFA] text-[#0D9488]',
  club: 'bg-[#FFF7ED] text-[#EA580C]',
  brand: 'bg-[#FFF1F2] text-[#E11D48]',
  umpire: 'bg-[#FEFCE8] text-[#A16207]', // warm amber — distinct from the other four at a glance
}

const formatRoleLabel = (value: string) => {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function RoleBadge({ role, className }: RoleBadgeProps) {
  if (!role) return null

  const normalizedRole = role.trim().toLowerCase()
  const baseClass = roleStyles[normalizedRole] ?? 'bg-gray-100 text-gray-600'
  const label = formatRoleLabel(normalizedRole)
  if (!label) return null

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium', baseClass, className)}>
      {label}
    </span>
  )
}
