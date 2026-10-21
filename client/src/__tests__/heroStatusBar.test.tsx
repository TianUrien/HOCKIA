/**
 * Batch C (2026-10-21): light status-bar glyphs over photo heroes, dark once
 * the compact glass header appears, dark again on leaving (native only; the
 * helper is a web no-op).
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setBar = vi.hoisted(() => vi.fn())
vi.mock('@/lib/nativeUi', () => ({ setStatusBarForBackground: setBar }))

import { CompactHeader } from '@/components/profile/v2/ProfileChrome'

describe('profile hero status bar', () => {
  beforeEach(() => setBar.mockClear())

  it('light glyphs over the hero, dark when the compact header shows, dark on leaving', () => {
    const { rerender, unmount } = render(<CompactHeader name="Ana" visible={false} owner={false} onShare={vi.fn()} />)
    expect(setBar).toHaveBeenLastCalledWith('dark-bg')
    rerender(<CompactHeader name="Ana" visible owner={false} onShare={vi.fn()} />)
    expect(setBar).toHaveBeenLastCalledWith('light-bg')
    rerender(<CompactHeader name="Ana" visible={false} owner={false} onShare={vi.fn()} />)
    expect(setBar).toHaveBeenLastCalledWith('dark-bg')
    unmount()
    expect(setBar).toHaveBeenLastCalledWith('light-bg')
  })
})
