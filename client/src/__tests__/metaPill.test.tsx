import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetaPill } from '@/components/ui/MetaPill'
import { IconButton } from '@/components/ui/IconButton'

/** Tag / Meta (Figma 582:7949) and the Glass / large Muted icon buttons. */
describe('MetaPill', () => {
  it('neutral tone = subtle grey surface with ink text (default)', () => {
    render(<MetaPill icon="club">Bayside Saints</MetaPill>)
    const pill = screen.getByTestId('meta-pill')
    expect(pill).toHaveAttribute('data-tone', 'neutral')
    expect(pill.className).toContain('bg-surface-subtle')
    expect(pill.className).toContain('text-ink-1')
    expect(pill.className).toContain('text-secondary')
    expect(pill.className).toContain('font-semibold')
    expect(pill.className).toContain('rounded-full')
    expect(pill.className).toContain('py-1.5')
    expect(pill.className).toContain('px-2')
    expect(pill).toHaveTextContent('Bayside Saints')
  })

  it('brand tone = soft brand with brand text', () => {
    render(<MetaPill tone="brand" icon="specialist">Grays</MetaPill>)
    const pill = screen.getByTestId('meta-pill')
    expect(pill.className).toContain('bg-brand-soft')
    expect(pill.className).toContain('text-brand-primary')
  })

  it.each([
    ['club', 'lucide-shield'],
    ['position', 'lucide-target'],
    ['specialist', 'lucide-sparkles'],
  ] as const)('icon %s renders the %s glyph at 15 px', (icon, cls) => {
    const { container } = render(<MetaPill icon={icon}>X</MetaPill>)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain(cls)
    expect(svg?.getAttribute('class')).toContain('h-[15px]')
  })

  it('renders without an icon', () => {
    const { container } = render(<MetaPill>Plain</MetaPill>)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('IconButton glass / large muted', () => {
  it('glass is dark glass: black 40 % with blur and a white icon', () => {
    render(<IconButton variant="glass" label="Back">x</IconButton>)
    const b = screen.getByRole('button', { name: 'Back' })
    expect(b.className).toContain('bg-black/40')
    expect(b.className).toContain('backdrop-blur-md')
    expect(b.className).toContain('text-white')
  })
  it('muted large is 48', () => {
    render(<IconButton variant="muted" size="large" label="Message club">x</IconButton>)
    const b = screen.getByRole('button', { name: 'Message club' })
    expect(b.className).toContain('h-12')
    expect(b.className).not.toContain('h-9')
  })
})
