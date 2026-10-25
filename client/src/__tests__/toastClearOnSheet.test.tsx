import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import ToastContainer from '@/components/ToastContainer'
import { useToastStore } from '@/lib/toast'

describe('toasts and sheets', () => {
  it('a sheet opening clears toasts already on screen', () => {
    render(<ToastContainer />)
    act(() => useToastStore.getState().addToast('Draft saved', 'success'))
    expect(screen.getByText('Draft saved')).toBeInTheDocument()
    act(() => { document.dispatchEvent(new Event('hockia:overlay-opened')) })
    expect(screen.queryByText('Draft saved')).toBeNull()
  })

  it('clearing with nothing on screen changes no state (a sheet re-announcing itself must not loop)', () => {
    act(() => useToastStore.setState({ toasts: [] }))
    const before = useToastStore.getState()
    useToastStore.getState().clearToasts()
    expect(useToastStore.getState()).toBe(before)
  })
})
