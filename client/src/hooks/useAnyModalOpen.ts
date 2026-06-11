import { useEffect, useState } from 'react'

/**
 * True while ANY modal dialog is open anywhere in the document.
 *
 * Detected via a MutationObserver over `[aria-modal="true"]` / `[role="dialog"]`
 * so it works for every modal pattern in the app — the shared `Modal`, the
 * preview sheets, AND one-off modals like `EditProfileModal` that render their
 * own overlay and don't use the shared body-scroll-lock signal.
 *
 * Used to hide the floating Hockia AI FAB so it never sits on top of a modal's
 * content/actions (e.g. covering Edit Profile's "Save Changes"). The
 * querySelector is cheap and only re-runs on DOM mutations that add/remove
 * nodes or change role/aria-modal. Modals in HOCKIA conditionally render (they
 * return null when closed), so a closed modal leaves nothing in the DOM to
 * match.
 */
export function useAnyModalOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return

    const check = () =>
      setOpen(document.querySelector('[aria-modal="true"], [role="dialog"]') !== null)

    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal'],
    })
    return () => observer.disconnect()
  }, [])

  return open
}
