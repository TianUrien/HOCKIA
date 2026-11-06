import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { BottomSheet } from '@/components/ui/BottomSheet'

// jsdom has no VisualViewport: a minimal one we can resize like iOS does when the keyboard opens.
class FakeViewport extends EventTarget {
  height = 800
  offsetTop = 0
}
let viewport: FakeViewport

beforeEach(() => {
  viewport = new FakeViewport()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})
afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
})

const root = () => screen.getByRole('dialog').parentElement as HTMLElement

describe('BottomSheet above the keyboard (goal "Other…", founder 2026-11-06)', () => {
  it('lifts the sheet by the keyboard height so its text field stays in view', () => {
    render(<BottomSheet open onClose={() => {}} ariaLabel="Your goal"><textarea aria-label="goal" /></BottomSheet>)
    expect(root().style.paddingBottom).toBe('')
    act(() => { viewport.height = 460; viewport.dispatchEvent(new Event('resize')) })
    expect(root().style.paddingBottom).toBe('340px')
    expect(screen.getByRole('dialog').style.maxHeight).toBe('calc(448px - env(safe-area-inset-top))')
    act(() => { viewport.height = 800; viewport.dispatchEvent(new Event('resize')) })
    expect(root().style.paddingBottom).toBe('')
  })

  it('ignores small viewport changes (the URL bar, not a keyboard)', () => {
    render(<BottomSheet open onClose={() => {}} ariaLabel="Sheet"><p>hi</p></BottomSheet>)
    act(() => { viewport.height = 740; viewport.dispatchEvent(new Event('resize')) })
    expect(root().style.paddingBottom).toBe('')
  })
})
