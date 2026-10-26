import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AddPhotoPrompt } from '@/components/profile/AddPhotoPrompt'

// Figma "Prompt / Add photo" (founder 2026-10-26): owner-only, dismissible, never blocking.
describe('AddPhotoPrompt', () => {
  it('shows the placeholder for the role, the copy and Add; Add and Not now call back', () => {
    const onAdd = vi.fn()
    const onDismiss = vi.fn()
    render(<AddPhotoPrompt role="coach" onAdd={onAdd} onDismiss={onDismiss} />)
    expect(screen.getByText('Add a photo')).toBeInTheDocument()
    expect(screen.getByText('So clubs and players know it’s you.')).toBeInTheDocument()
    expect(screen.getByTestId('role-placeholder').getAttribute('data-role')).toBe('coach')
    fireEvent.click(screen.getByTestId('add-photo-prompt-add'))
    expect(onAdd).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('uses Tonal for Add when another Primary owns the screen, and Player for an unknown role', () => {
    render(<AddPhotoPrompt role={null} onAdd={() => {}} secondary />)
    expect(screen.getByTestId('role-placeholder').getAttribute('data-role')).toBe('player')
    expect(screen.getByTestId('add-photo-prompt-add').className).not.toContain('shadow-glow-brand')
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
  })
})
