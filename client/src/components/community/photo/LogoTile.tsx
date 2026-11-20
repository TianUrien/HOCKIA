import { OrgLogo } from '@/components/ui/OrgLogo'

/**
 * A club crest or brand logo on Community cards and previews. The tile itself
 * (white rounded square, fill or inset) is OrgLogo, shared with the rest of
 * the app; the caller gives the size, position and shadow.
 */
interface LogoTileProps {
  src: string
  name: string
  /** Size, position and shadow of the tile. */
  className?: string
  eager?: boolean
  onError?: () => void
  /** No-photo treatment when the logo fails: club (default) or brand. */
  role?: 'club' | 'brand'
}

export function LogoTile({ src, className, eager = false, onError, role = 'club' }: LogoTileProps) {
  return <OrgLogo src={src} role={role} className={className} eager={eager} onError={onError} />
}
