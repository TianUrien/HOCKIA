import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RolePlaceholder from '@/components/RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'
import Avatar from '@/components/Avatar'

vi.mock('@/components/ProfileImagePreviewProvider', () => ({
  useProfileImagePreview: () => ({ openPreview: vi.fn() }),
}))

describe('RolePlaceholder', () => {
  it('renders a labelled SVG when label is provided', () => {
    render(<RolePlaceholder role="player" label="Maria Garcia profile photo" />)
    expect(screen.getByLabelText('Maria Garcia profile photo')).toBeInTheDocument()
  })

  it('renders a decorative (presentation) SVG when label is empty string', () => {
    const { container } = render(<RolePlaceholder role="coach" label="" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('role')).toBe('presentation')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('falls back to a role-named accessible label when none is given', () => {
    render(<RolePlaceholder role="umpire" />)
    expect(screen.getByLabelText(/umpire profile photo placeholder/i)).toBeInTheDocument()
  })

  it('applies a different colour palette per role (smoke check via stop-color attrs)', () => {
    const colors: Record<string, string> = {}
    for (const r of ['player', 'coach', 'club', 'brand', 'umpire'] as const) {
      const { container } = render(<RolePlaceholder role={r} label="x" />)
      const stop = container.querySelector('linearGradient stop')
      colors[r] = stop?.getAttribute('stop-color') ?? ''
    }
    // All five roles must have distinct palette starts.
    const distinct = new Set(Object.values(colors))
    expect(distinct.size).toBe(5)
  })
})

describe('isRoleAvatarRole', () => {
  it('accepts the 5 known roles', () => {
    for (const r of ['player', 'coach', 'club', 'brand', 'umpire']) {
      expect(isRoleAvatarRole(r)).toBe(true)
    }
  })

  it('rejects unknown / null / non-string values', () => {
    expect(isRoleAvatarRole(null)).toBe(false)
    expect(isRoleAvatarRole(undefined)).toBe(false)
    expect(isRoleAvatarRole('member')).toBe(false)
    expect(isRoleAvatarRole('admin')).toBe(false)
    expect(isRoleAvatarRole(42)).toBe(false)
  })
})

describe('Avatar — role-placeholder fallback', () => {
  it('renders RolePlaceholder when src is missing AND role is recognised', () => {
    const { container } = render(<Avatar role="player" alt="Maria" />)
    // SVG present, no initials span fallback rendered.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('?')).not.toBeInTheDocument()
  })

  it('does NOT render RolePlaceholder when src is provided', () => {
    const { container } = render(<Avatar src="https://example.com/a.png" role="player" alt="Maria" />)
    // Image element present, no SVG placeholder.
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('falls back to initials when src is missing AND role is not recognised', () => {
    const { container } = render(<Avatar initials="MG" role={null} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('MG')).toBeInTheDocument()
  })

  it('omits the purple gradient bg class when the role placeholder is rendered', () => {
    const { container } = render(<Avatar role="coach" />)
    // Outer wrapper should NOT have the legacy purple-to-purple gradient
    // since the SVG fills the box itself.
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('from-[#8026FA]')
  })

  it('keeps the purple gradient bg class for the initials fallback (no role)', () => {
    const { container } = render(<Avatar initials="MG" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('from-[#8026FA]')
  })

  it('falls back to RolePlaceholder when src loads but errors (broken URL)', () => {
    // Regression guard: a real photo URL that 404s should still show the
    // role-tinted placeholder, not a broken-image icon. The onError
    // handler flips imageError → next render goes through the
    // showRolePlaceholder path.
    const { container } = render(<Avatar src="https://broken.test/x.png" role="coach" alt="X" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    // After the error, the SVG should be present and no img element.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('treats empty-string src the same as missing src (placeholder shown)', () => {
    // Belt-and-braces: profiles that store '' (rare, but possible from
    // legacy migrations) should still show the placeholder, not be
    // treated as a valid src that fails to load.
    const { container } = render(<Avatar src="" role="club" alt="X" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })
})
