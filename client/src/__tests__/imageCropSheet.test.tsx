/**
 * The crop step: opens on the automatic fit, shows the final shape, warns on
 * a small image, and resolves with the rendered square or null on cancel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImageAnalysis } from '@/lib/imageFit'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

let size = { width: 1200, height: 400 }
let analysis: ImageAnalysis = { transparent: false, uniformEdge: true, edgeColor: [20, 60, 200], blankBackground: false, content: { x: 0, y: 0, w: 1, h: 1 }, empty: false }
const renderCrop = vi.fn<(...args: unknown[]) => Promise<File>>(async () => new File(['sq'], 'out.png', { type: 'image/png' }))
const loadImageFile = vi.fn(async () => ({ element: {} as HTMLImageElement, url: 'blob:test', ...size }))
vi.mock('@/lib/imageCropRender', () => ({
  loadImageFile: () => loadImageFile(),
  releaseImage: vi.fn(),
  sampleImage: () => analysis,
  renderCrop: (...a: unknown[]) => renderCrop(...a),
}))

import ImageCropSheet from '@/components/media/ImageCropSheet'
import { ImageCropProvider, useImageCrop } from '@/components/media/ImageCropProvider'

const file = new File(['x'], 'wide.png', { type: 'image/png' })

beforeEach(() => {
  size = { width: 1200, height: 400 }
  analysis = { transparent: false, uniformEdge: true, edgeColor: [20, 60, 200], blankBackground: false, content: { x: 0, y: 0, w: 1, h: 1 }, empty: false }
  renderCrop.mockClear()
  loadImageFile.mockClear()
})

describe('ImageCropSheet', () => {
  it('opens a wide logo whole, completed with its own colour, and renders that on confirm', async () => {
    const onDone = vi.fn()
    render(<ImageCropSheet file={file} kind="logo" onDone={onDone} />)
    const confirm = await screen.findByTestId('image-crop-confirm')
    await waitFor(() => expect(confirm).not.toBeDisabled())
    expect(screen.getByTestId('image-crop-stage').style.backgroundColor).toBe('rgb(20, 60, 200)')
    expect(screen.getByRole('heading', { name: 'Adjust your logo' })).toBeInTheDocument()
    fireEvent.click(confirm)
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(renderCrop.mock.calls[0][1]).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(renderCrop.mock.calls[0][2]).toMatchObject({ kind: 'logo', background: 'rgb(20, 60, 200)', sourceType: 'image/png' })
    expect(onDone.mock.calls[0][0]).toBeInstanceOf(File)
  })

  it('previews an organisation as rounded squares and a person as circles', async () => {
    const { unmount } = render(<ImageCropSheet file={file} kind="crest" onDone={vi.fn()} />)
    const previews = await screen.findByTestId('image-crop-previews')
    expect(previews.children).toHaveLength(3)
    expect([...previews.children].every((el) => el.className.includes('rounded-[25%]'))).toBe(true)
    unmount()
    render(<ImageCropSheet file={file} kind="person" onDone={vi.fn()} />)
    const circles = await screen.findByTestId('image-crop-previews')
    expect([...circles.children].every((el) => el.className.includes('rounded-full'))).toBe(true)
    // A person has no "show it all": the photo always fills the circle.
    expect(screen.queryByTestId('image-crop-fit')).not.toBeInTheDocument()
  })

  it('fills the square on request and can go back to the automatic fit', async () => {
    const onDone = vi.fn()
    render(<ImageCropSheet file={file} kind="logo" onDone={onDone} />)
    fireEvent.click(await screen.findByTestId('image-crop-fill'))
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(renderCrop).toHaveBeenCalledTimes(1))
    expect(renderCrop.mock.calls[0][1]).toEqual({ zoom: 3, x: 0, y: 0 })
  })

  it('moves with the arrow keys and zooms with the slider', async () => {
    render(<ImageCropSheet file={file} kind="logo" onDone={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('image-crop-fill'))
    fireEvent.keyDown(screen.getByTestId('image-crop-stage'), { key: 'ArrowRight' })
    fireEvent.change(screen.getByTestId('image-crop-zoom'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(renderCrop).toHaveBeenCalledTimes(1))
    const crop = renderCrop.mock.calls[0][1] as { zoom: number; x: number }
    expect(crop.zoom).toBe(9)
    expect(crop.x).toBeGreaterThan(0)
  })

  it('drags with one pointer and zooms with two', async () => {
    render(<ImageCropSheet file={file} kind="logo" onDone={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('image-crop-fill'))
    const stage = screen.getByTestId('image-crop-stage')
    Object.defineProperty(stage, 'clientWidth', { value: 300, configurable: true })
    // One finger: 60 px to the right on a 300 px stage is 0.2 of a side.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 100 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    // Two fingers moving apart: twice the distance is twice the zoom.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 150 })
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 150 })
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 150 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 2 })
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(renderCrop).toHaveBeenCalledTimes(1))
    const crop = renderCrop.mock.calls[0][1] as { zoom: number; x: number; y: number }
    expect(crop.zoom).toBeCloseTo(6)
    expect(crop.x).toBeCloseTo(0.4)
    expect(crop.y).toBe(0)
  })

  it('warns when the image is small, without blocking it', async () => {
    size = { width: 180, height: 180 }
    render(<ImageCropSheet file={file} kind="logo" onDone={vi.fn()} />)
    expect(await screen.findByTestId('image-crop-small')).toHaveTextContent('180 × 180')
    expect(screen.getByTestId('image-crop-confirm')).not.toBeDisabled()
  })

  it('does not warn for a large image', async () => {
    render(<ImageCropSheet file={file} kind="logo" onDone={vi.fn()} />)
    await screen.findByTestId('image-crop-fill')
    expect(screen.queryByTestId('image-crop-small')).not.toBeInTheDocument()
  })

  it('refuses an image with nothing in it and says why', async () => {
    analysis = { transparent: true, uniformEdge: false, edgeColor: [255, 255, 255], blankBackground: true, content: { x: 0, y: 0, w: 1, h: 1 }, empty: true }
    const onDone = vi.fn()
    render(<ImageCropSheet file={file} kind="crest" onDone={onDone} />)
    expect(await screen.findByTestId('image-crop-empty')).toHaveTextContent('This image looks empty')
    const confirm = screen.getByTestId('image-crop-confirm')
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(renderCrop).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    // Cancel still works, so the member can pick another file.
    fireEvent.click(screen.getByTestId('image-crop-cancel'))
    expect(onDone).toHaveBeenCalledWith(null)
  })

  it('resolves null on cancel', async () => {
    const onDone = vi.fn()
    render(<ImageCropSheet file={file} kind="logo" onDone={onDone} />)
    fireEvent.click(await screen.findByTestId('image-crop-cancel'))
    expect(onDone).toHaveBeenCalledWith(null)
    expect(renderCrop).not.toHaveBeenCalled()
  })

  it('says so when the image cannot be opened', async () => {
    loadImageFile.mockRejectedValueOnce(new Error('bad file'))
    render(<ImageCropSheet file={file} kind="logo" onDone={vi.fn()} />)
    expect(await screen.findByText('This image could not be opened. Try another one.')).toBeInTheDocument()
    expect(screen.queryByTestId('image-crop-confirm')).not.toBeInTheDocument()
  })
})

describe('ImageCropProvider', () => {
  function Picker({ onResult }: { onResult: (f: File | null) => void }) {
    const requestCrop = useImageCrop()
    return <button type="button" onClick={() => void requestCrop(file, 'crest').then(onResult)}>pick</button>
  }

  it('shows the sheet for a picked file and hands back the square', async () => {
    const onResult = vi.fn()
    render(<ImageCropProvider><Picker onResult={onResult} /></ImageCropProvider>)
    fireEvent.click(screen.getByText('pick'))
    const confirm = await screen.findByTestId('image-crop-confirm')
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(onResult.mock.calls[0][0]).toBeInstanceOf(File)
    await waitFor(() => expect(screen.queryByTestId('image-crop-sheet')).not.toBeInTheDocument())
  })

  it('hands back null when the member cancels', async () => {
    const onResult = vi.fn()
    render(<ImageCropProvider><Picker onResult={onResult} /></ImageCropProvider>)
    fireEvent.click(screen.getByText('pick'))
    fireEvent.click(await screen.findByTestId('image-crop-cancel'))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
  })
})
