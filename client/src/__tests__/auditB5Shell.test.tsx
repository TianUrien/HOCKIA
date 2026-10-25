/**
 * Design audit 2026-10-21, B5: the desktop shell. No tagline pill beside the
 * logo on app pages, one (brand) wordmark colour, no grabbers on desktop
 * dialogs, focus rings only for keyboard focus (:focus-visible).
 */
import { render, screen } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn(), isTopFocusTrap: () => true }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }))

import { BottomSheet } from '@/components/ui/BottomSheet'

const SRC = resolve(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('app shell (desktop header)', () => {
  const header = read('components/Header.tsx')

  it('has no tagline pill next to the logo', () => {
    expect(header).not.toMatch(/sticks together/i)
    expect(header).not.toContain('bg-[#c2410c]')
  })

  it('uses one wordmark colour on every page: ink (rebrand 2026-10-25, Figma Nav / Top bar)', () => {
    expect(header).toContain('/brand/wordmark/hockia-wordmark-black.svg')
    expect(header).not.toContain('hockia-wordmark-violet.svg')
  })
})

describe('no grabbers on desktop dialogs', () => {
  it('the shared bottom sheet hides its grabber from 1024 px', () => {
    render(<BottomSheet open onClose={() => {}} ariaLabel="Test sheet"><p>Body</p></BottomSheet>)
    const grabber = screen.getByRole('dialog').querySelector('.h-\\[5px\\]')
    expect(grabber?.className).toContain('lg:hidden')
  })

  it('the Hockia AI sheet grabber hides on desktop too', () => {
    expect(read('components/hockiaAi/HockiaAiSheet.tsx')).toMatch(/h-\[5px\] w-10 rounded-full bg-ink-4\/60 lg:hidden/)
  })
})

describe('focus rings only on keyboard focus', () => {
  it('no component draws a ring on plain :focus (it would show after a mouse click)', () => {
    const offenders = walk(SRC).filter((p) => /(^|[^-\w])focus:ring/.test(readFileSync(p, 'utf8')))
    expect(offenders.map((p) => p.replace(SRC, ''))).toEqual([])
  })
})
