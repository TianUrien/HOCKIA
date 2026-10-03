import { Instagram, Linkedin, Facebook } from 'lucide-react'

/**
 * Official HOCKIA social channels — single source of truth. Used by the
 * Footer (light surfaces) and the Landing hero (dark surface). Update the
 * URLs here only.
 */
const HOCKIA_SOCIALS = [
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/inhockia/',
    Icon: Instagram,
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/hockia/',
    Icon: Linkedin,
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61590881692674',
    Icon: Facebook,
  },
] as const

interface HockiaSocialsProps {
  /** 'muted' = grey icons for light surfaces (footer); 'ink' = ink-2 icons
   *  with 44 pt targets on the token-based landing footer (Web A v2);
   *  'onDark' = white icons for dark surfaces; 'onBrand' = white icons in
   *  frosted circle chips for the solid-violet CTA band (Web A design). */
  tone?: 'muted' | 'ink' | 'onDark' | 'onBrand'
  iconClassName?: string
  className?: string
}

export default function HockiaSocials({
  tone = 'muted',
  iconClassName = 'w-5 h-5',
  className = '',
}: HockiaSocialsProps) {
  const linkTone =
    tone === 'onBrand'
      ? 'flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.12] text-white hover:bg-white/20'
      : tone === 'onDark'
        ? 'text-white/70 hover:text-white'
        : tone === 'ink'
          ? 'flex h-11 w-11 items-center justify-center rounded-lg text-ink-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40'
          : 'text-gray-500 dark:text-gray-400 hover:text-hockia-primary dark:hover:text-purple-400'
  // 'ink' targets are 44 pt boxes, so the row needs no extra gap.
  const gap = tone === 'onBrand' ? 'gap-2' : tone === 'ink' ? 'gap-0' : 'gap-4'

  return (
    <div
      className={`flex items-center ${gap} ${className}`}
      aria-label="Follow HOCKIA on social media"
    >
      {HOCKIA_SOCIALS.map(({ label, href, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`HOCKIA on ${label} (opens in a new tab)`}
          title={label}
          className={`${linkTone} transition-colors hover:scale-110`}
        >
          <Icon className={iconClassName} />
        </a>
      ))}
    </div>
  )
}
