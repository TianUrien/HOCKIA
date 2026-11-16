/**
 * useKeyboardShortcuts
 *
 * Global keyboard shortcuts for navigation and search focus.
 * Follows the GitHub/Slack pattern: `/` for search, `g + key` for navigation.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface ShortcutConfig {
  onShowHelp: () => void
}

const NAVIGATION_SHORTCUTS = [
  { key: 'c', path: '/community' },
  { key: 'o', path: '/opportunities' },
  { key: 'w', path: '/world' },
  { key: 'b', path: '/marketplace' },
  { key: 'm', path: '/messages' },
  { key: 'd', path: '/dashboard/profile' },
] as const

function shouldIgnoreKeypress(): boolean {
  // Don't fire when a modal is open
  if (document.querySelector('[role="dialog"]')) return true

  // Don't fire when typing in form elements
  const el = document.activeElement
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  ) {
    return true
  }

  return false
}

function focusSearchInput() {
  const input = document.querySelector(
    'input[data-keyboard-shortcut="search"]'
  ) as HTMLInputElement | null

  if (input) {
    input.focus()
    input.select()
  }
}

export function useKeyboardShortcuts({ onShowHelp }: ShortcutConfig) {
  const navigate = useNavigate()
  const gPressedRef = useRef(false)
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onShowHelpRef = useRef(onShowHelp)
  onShowHelpRef.current = onShowHelp

  const clearGState = useCallback(() => {
    gPressedRef.current = false
    if (gTimeoutRef.current) {
      clearTimeout(gTimeoutRef.current)
      gTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreKeypress()) return

      const key = e.key

      // ? — show help (Shift+/)
      if (key === '?') {
        e.preventDefault()
        onShowHelpRef.current()
        return
      }

      // / — focus search
      if (key === '/') {
        e.preventDefault()
        focusSearchInput()
        return
      }

      // g — start chord
      if (key === 'g' && !gPressedRef.current) {
        gPressedRef.current = true
        gTimeoutRef.current = setTimeout(() => {
          gPressedRef.current = false
        }, 1000)
        return
      }

      // Second key after g
      if (gPressedRef.current) {
        const match = NAVIGATION_SHORTCUTS.find(s => s.key === key)
        if (match) {
          e.preventDefault()
          navigate(match.path)
        }
        clearGState()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearGState()
    }
  }, [navigate, clearGState])
}

/**
 * Shortcut definitions for the help modal. `category` and `description` are
 * keys in the common catalog (shortcuts.*); the modal translates them.
 */
export const KEYBOARD_SHORTCUTS = [
  {
    category: 'shortcuts.groups.navigation',
    shortcuts: [
      { keys: ['g', 'c'], description: 'shortcuts.goCommunity' },
      { keys: ['g', 'o'], description: 'shortcuts.goOpportunities' },
      { keys: ['g', 'w'], description: 'shortcuts.goWorld' },
      { keys: ['g', 'b'], description: 'shortcuts.goMarketplace' },
      { keys: ['g', 'm'], description: 'shortcuts.goMessages' },
      { keys: ['g', 'd'], description: 'shortcuts.goDashboard' },
    ],
  },
  {
    category: 'shortcuts.groups.search',
    shortcuts: [
      { keys: ['/'], description: 'shortcuts.focusSearch' },
    ],
  },
  {
    category: 'shortcuts.groups.help',
    shortcuts: [
      { keys: ['?'], description: 'shortcuts.showHelp' },
    ],
  },
] as const
