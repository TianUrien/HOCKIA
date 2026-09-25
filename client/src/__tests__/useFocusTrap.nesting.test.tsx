/**
 * Nested focus traps (Sentry JAVASCRIPT-REACT-9B).
 *
 * MemberPreviewSheet's BottomSheet keeps a focus trap on while the photo
 * MediaLightbox (its own trap) is open on top. Each trap used to listen to
 * every document focus event and pull focus back into itself, so the two
 * ping-ponged `focus()` until iOS Safari threw "Maximum call stack size
 * exceeded". Only the top-most trap may enforce focus.
 */
import { useRef, useState } from 'react'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { BottomSheet } from '@/components/ui/BottomSheet'

// jsdom has no layout, so offsetParent is always null and the hook would
// treat every button as hidden. Make everything count as visible.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Trap({ label, extra }: { label: string; extra?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: ref, isActive: true })
  return (
    <div ref={ref} tabIndex={-1} data-testid={`trap-${label}`}>
      <button type="button">{label}</button>
      {extra && <button type="button">{extra}</button>}
    </div>
  )
}

/** Sheet that opens a lightbox on tap, like MemberPreviewSheet. */
function SheetWithLightbox() {
  const [photoOpen, setPhotoOpen] = useState(false)
  return (
    <>
      <button type="button">page</button>
      <Trap label="sheet-placeholder" />
      <SheetBody onOpen={() => setPhotoOpen(true)} />
      {photoOpen && <LightboxTrap onClose={() => setPhotoOpen(false)} />}
    </>
  )
}

function SheetBody({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}>
      open photo
    </button>
  )
}

function LightboxTrap({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: ref, isActive: true })
  return (
    <div ref={ref} tabIndex={-1}>
      <button type="button" onClick={onClose}>
        close lightbox
      </button>
      <button type="button">next</button>
    </div>
  )
}

function activeText() {
  return (document.activeElement as HTMLElement | null)?.textContent ?? null
}

describe('useFocusTrap — nested traps', () => {
  it('two simultaneously active traps do not ping-pong focus (stack overflow)', () => {
    const r = render(
      <>
        <Trap label="sheet" />
        <Trap label="lightbox" />
      </>,
    )
    const lightboxBtn = r.getByText('lightbox') as HTMLButtonElement
    expect(() => lightboxBtn.focus()).not.toThrow()
    expect(activeText()).toBe('lightbox')

    // Focus escaping to the lower trap is pulled back to the top one, once.
    expect(() => (r.getByText('sheet') as HTMLButtonElement).focus()).not.toThrow()
    expect(activeText()).toBe('lightbox')
  })

  it('a trap opened on top of another gets focus, and closing it restores focus into the lower trap', () => {
    const r = render(<SheetWithLightbox />)
    // Lower trap is active: focus lands in it.
    expect(activeText()).toBe('sheet-placeholder')

    const opener = r.getByText('open photo') as HTMLButtonElement
    // The opener is outside the lower trap in this fixture, so drive it by click.
    fireEvent.click(opener)
    // Top trap took initial focus and kept it.
    expect(activeText()).toBe('close lightbox')

    fireEvent.click(r.getByText('close lightbox'))
    // Focus returns to the element focused before the lightbox opened,
    // which is inside the (still active) lower trap.
    expect(activeText()).toBe('sheet-placeholder')

    // Lower trap enforces again once it is the top.
    ;(r.getByText('page') as HTMLButtonElement).focus()
    expect(activeText()).toBe('sheet-placeholder')
  })

  it('Tab wrapping only applies to the top-most trap', () => {
    const r = render(
      <>
        <Trap label="sheet-a" extra="sheet-b" />
        <Trap label="box-a" extra="box-b" />
      </>,
    )
    ;(r.getByText('box-b') as HTMLButtonElement).focus()
    const ev = fireEvent.keyDown(document, { key: 'Tab' })
    // Only the top trap wrapped (preventDefault → fireEvent returns false)
    // and focus is on the top trap's first element, not the sheet's.
    expect(ev).toBe(false)
    expect(activeText()).toBe('box-a')
  })

  it('unmounting a lower trap while a top trap is open does not steal focus from the top', () => {
    function Harness({ showLower }: { showLower: boolean }) {
      return (
        <>
          <button type="button">page</button>
          {showLower && <Trap label="lower" />}
          <Trap label="upper" />
        </>
      )
    }
    const r = render(<Harness showLower />)
    ;(r.getByText('upper') as HTMLButtonElement).focus()
    r.rerender(<Harness showLower={false} />)
    expect(activeText()).toBe('upper')
  })
})

describe('BottomSheet + nested overlay (MemberPreviewSheet shape)', () => {
  function SheetHarness({ onSheetClose, onBoxClose }: { onSheetClose: () => void; onBoxClose: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <BottomSheet open onClose={onSheetClose} ariaLabel="Member preview">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open photo">
            photo
          </button>
          <button type="button">Add friend</button>
        </BottomSheet>
        {open && (
          <LightboxTrap
            onClose={() => {
              onBoxClose()
              setOpen(false)
            }}
          />
        )}
      </>
    )
  }

  it('opening the photo over the sheet does not throw and focus lands in the lightbox', () => {
    const r = render(<SheetHarness onSheetClose={() => {}} onBoxClose={() => {}} />)
    const photo = r.getByLabelText('Open photo') as HTMLButtonElement
    photo.focus()
    expect(() => fireEvent.click(photo)).not.toThrow()
    const close = r.getByText('close lightbox') as HTMLButtonElement
    expect(() => close.focus()).not.toThrow()
    expect(document.activeElement).toBe(close)

    // Closing the lightbox returns focus to the photo button in the sheet.
    act(() => {
      fireEvent.click(close)
    })
    expect(document.activeElement).toBe(r.getByLabelText('Open photo'))
  })

  it('Escape closes only the top-most overlay, not the sheet beneath it', () => {
    const onSheetClose = vi.fn()
    const r = render(<SheetHarness onSheetClose={onSheetClose} onBoxClose={() => {}} />)
    fireEvent.click(r.getByLabelText('Open photo'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onSheetClose).not.toHaveBeenCalled()

    fireEvent.click(r.getByText('close lightbox'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onSheetClose).toHaveBeenCalledTimes(1)
  })

  it('a sheet over a sheet (sign-in prompt over member preview): Escape closes only the top one', () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const r = render(
      <>
        <BottomSheet open onClose={lower} ariaLabel="Member preview">
          <button type="button">Message</button>
        </BottomSheet>
        <BottomSheet open={false} onClose={upper} ariaLabel="Join">
          <button type="button">Create profile</button>
        </BottomSheet>
      </>,
    )
    r.rerender(
      <>
        <BottomSheet open onClose={lower} ariaLabel="Member preview">
          <button type="button">Message</button>
        </BottomSheet>
        <BottomSheet open onClose={upper} ariaLabel="Join">
          <button type="button">Create profile</button>
        </BottomSheet>
      </>,
    )
    expect(activeText()).toBe('Create profile')
    expect(() => (r.getByText('Message') as HTMLButtonElement).focus()).not.toThrow()
    expect(activeText()).toBe('Create profile')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(upper).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
  })
})
