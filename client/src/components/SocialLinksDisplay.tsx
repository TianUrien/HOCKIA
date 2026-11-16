import { SOCIAL_PLATFORMS, type SocialLinks } from '@/lib/socialLinks'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

interface SocialLinksDisplayProps {
  links: SocialLinks | null | undefined
  className?: string
  iconSize?: 'sm' | 'md' | 'lg'
}

const iconSizes = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
}

const containerSizes = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
}

export default function SocialLinksDisplay({ 
  links, 
  className = '',
  iconSize = 'md'
}: SocialLinksDisplayProps) {
  const t = useProfileEditT()
  // Filter to only show platforms with valid URLs
  const activeLinks = SOCIAL_PLATFORMS.filter(
    platform => links?.[platform.key]?.trim()
  )

  if (activeLinks.length === 0) {
    return null
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {activeLinks.map(({ key, label, icon: Icon, color, hoverColor }) => {
        const url = links?.[key]
        if (!url) return null

        // Ensure URL has protocol
        const href = url.startsWith('http') ? url : `https://${url}`

        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${containerSizes[iconSize]} flex items-center justify-center rounded-full bg-gray-100 ${color} ${hoverColor} transition-all hover:scale-110 hover:shadow-md`}
            aria-label={t('social.visit', { platform: label })}
            title={label}
          >
            <Icon className={iconSizes[iconSize]} />
          </a>
        )
      })}
    </div>
  )
}
