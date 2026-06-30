/**
 * ContactModal — logged-out "Contact Us" support modal.
 *
 * Why a modal instead of a bare `mailto:` link: on DESKTOP browsers a mailto only
 * does something if the user has a registered mail handler — otherwise the click
 * silently no-ops (exactly the "nothing happens" report). The modal always works:
 * it shows the support address with a Copy button (every platform) plus an
 * "Open email app" button (mailto, for mobile / desktops that have a handler).
 *
 * Bottom sheet on mobile, centered card on desktop. Portal'd to document.body so
 * it escapes the Landing's fixed / overflow-hidden root. Tap-outside + Escape close.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Mail, Copy, Check } from 'lucide-react'
import { SUPPORT_EMAIL, openSupportEmail, copySupportEmail, useContactModal } from '@/lib/contact'

export default function ContactModal() {
  const isOpen = useContactModal((s) => s.isOpen)
  const close = useContactModal((s) => s.close)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // Tap-outside to close
  useEffect(() => {
    if (!isOpen) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (dialogRef.current && !dialogRef.current.contains(target)) close()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [isOpen, close])

  // Move focus into the dialog on open; reset the "Copied!" affordance on close.
  useEffect(() => {
    if (isOpen) {
      const id = window.setTimeout(() => dialogRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
    setCopied(false)
  }, [isOpen])

  if (!isOpen) return null
  if (typeof document === 'undefined') return null

  const handleCopy = async () => {
    const ok = await copySupportEmail()
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-gray-900/50 sm:items-center"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm bg-white shadow-2xl rounded-t-2xl sm:rounded-2xl animate-fade-in outline-none pb-[env(safe-area-inset-bottom)] sm:pb-0"
        data-testid="contact-modal"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#8026FA]/10">
              <Mail className="h-5 w-5 text-[#8026FA]" />
            </span>
            <h2 id="contact-modal-title" className="text-lg font-bold text-gray-900">
              Contact us
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 pt-3">
          <p className="text-sm text-gray-600">
            Questions before joining HOCKIA? We're happy to help — reach the team at:
          </p>

          {/* The email itself — selectable, with an always-works Copy action. */}
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="select-all break-all font-medium text-gray-900" data-testid="contact-email">
              {SUPPORT_EMAIL}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy email address"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#8026FA] transition-colors hover:bg-[#8026FA]/10"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Primary action — opens the mail app (mobile + desktops with a handler). */}
          <button
            type="button"
            onClick={openSupportEmail}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-5 py-3 text-base font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
          >
            <Mail className="h-5 w-5" />
            Open email app
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
