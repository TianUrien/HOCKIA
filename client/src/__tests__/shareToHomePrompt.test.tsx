import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const trackDbEvent = vi.hoisted(() => vi.fn())
const addToast = vi.hoisted(() => vi.fn())
const invalidateQueries = vi.hoisted(() => vi.fn())

vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent }))
vi.mock('@/lib/toast', () => ({
  useToastStore: (select: (s: { addToast: typeof addToast }) => unknown) => select({ addToast }),
}))
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries } }))
const rpc = vi.hoisted(() => vi.fn())
const validateVideoFull = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('@/lib/imageOptimization', () => ({ validateVideoFull }))
vi.mock('@/components/home/PostComposerModal', () => ({
  PostComposerModal: ({ initialImageFiles, initialVideoFile, onPostCreated, onClose }: { initialImageFiles?: File[]; initialVideoFile?: File | null; onPostCreated: (item: unknown) => void; onClose: () => void }) => (
    <div data-testid="composer-modal">
      <span data-testid="composer-files">{initialImageFiles?.map((f) => f.name).join(',')}</span>
      <span data-testid="composer-video">{initialVideoFile?.name}</span>
      <button type="button" onClick={() => { onPostCreated({}); onClose() }}>post</button>
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}))

import { ShareToHomePrompt, SHARE_TO_HOME_MAX_PHOTOS } from '@/components/home/ShareToHomePrompt'
import { shareableVideo } from '@/lib/shareToHome'

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const user = userEvent.setup()

describe('ShareToHomePrompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing and tracks nothing without photos', () => {
    const { container } = render(<ShareToHomePrompt files={[]} onDone={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    expect(trackDbEvent).not.toHaveBeenCalled()
  })

  it('asks about one photo in the singular and records the view once', () => {
    const files = [photo('a.jpg')]
    const { rerender } = render(<ShareToHomePrompt files={files} onDone={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Share this photo on Home?' })).toBeInTheDocument()
    rerender(<ShareToHomePrompt files={files} onDone={vi.fn()} />)
    expect(trackDbEvent).toHaveBeenCalledTimes(1)
    expect(trackDbEvent).toHaveBeenCalledWith('share_to_home_prompt', undefined, undefined, { action: 'view', media_type: 'photo', count: 1 })
  })

  it('asks about several photos in the plural', () => {
    render(<ShareToHomePrompt files={[photo('a.jpg'), photo('b.jpg')]} onDone={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Share these photos on Home?' })).toBeInTheDocument()
  })

  it('"Not now" closes the prompt without opening the composer', async () => {
    const onDone = vi.fn()
    render(<ShareToHomePrompt files={[photo('a.jpg')]} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('composer-modal')).not.toBeInTheDocument()
    expect(trackDbEvent).toHaveBeenLastCalledWith('share_to_home_prompt', undefined, undefined, { action: 'dismiss', media_type: 'photo', count: 1 })
  })

  it('"Share" opens the composer with the photos, capped at the post limit', async () => {
    const files = Array.from({ length: SHARE_TO_HOME_MAX_PHOTOS + 2 }, (_, i) => photo(`p${i}.jpg`))
    render(<ShareToHomePrompt files={files} onDone={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const names = (await screen.findByTestId('composer-files')).textContent
    expect(names).toBe('p0.jpg,p1.jpg,p2.jpg,p3.jpg,p4.jpg')
  })

  it('a created post refreshes Home, confirms and ends the prompt', async () => {
    const onDone = vi.fn()
    render(<ShareToHomePrompt files={[photo('a.jpg')]} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'post' }))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['home-feed'] })
    expect(addToast).toHaveBeenCalledWith('Shared on Home.', 'success')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('closing the composer without posting also ends the prompt', async () => {
    const onDone = vi.fn()
    render(<ShareToHomePrompt files={[photo('a.jpg')]} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'close' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(addToast).not.toHaveBeenCalled()
  })

  describe('video', () => {
    const clip = new File(['x'], 'goal.mp4', { type: 'video/mp4' })
    beforeEach(() => {
      rpc.mockResolvedValue({ data: true, error: null })
      validateVideoFull.mockResolvedValue({ valid: true })
    })

    it('offers only a public highlight', () => {
      expect(shareableVideo({ file: clip, kind: 'highlight', visibility: 'public' })).toBe(clip)
      expect(shareableVideo({ file: clip, kind: 'highlight', visibility: 'recruiters' })).toBeNull()
      expect(shareableVideo({ file: clip, kind: 'full_match', visibility: 'public' })).toBeNull()
    })

    it('asks about the video and hands it to the composer', async () => {
      render(<ShareToHomePrompt video={clip} onDone={vi.fn()} />)
      expect(await screen.findByRole('heading', { name: 'Share this video on Home?' })).toBeInTheDocument()
      expect(rpc).toHaveBeenCalledWith('video_posts_enabled')
      expect(trackDbEvent).toHaveBeenCalledWith('share_to_home_prompt', undefined, undefined, { action: 'view', media_type: 'video', count: 1 })
      await user.click(screen.getByRole('button', { name: 'Share' }))
      expect((await screen.findByTestId('composer-video')).textContent).toBe('goal.mp4')
      expect(screen.getByTestId('composer-files').textContent).toBe('')
    })

    it('stays hidden while video posts are switched off', async () => {
      rpc.mockResolvedValue({ data: false, error: null })
      const { container } = render(<ShareToHomePrompt video={clip} onDone={vi.fn()} />)
      await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
      await Promise.resolve()
      expect(container.innerHTML).toBe('')
      expect(validateVideoFull).not.toHaveBeenCalled()
      expect(trackDbEvent).not.toHaveBeenCalled()
    })

    it('stays hidden when the flag cannot be read', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'network' } })
      const { container } = render(<ShareToHomePrompt video={clip} onDone={vi.fn()} />)
      await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
      await Promise.resolve()
      expect(container.innerHTML).toBe('')
    })

    it('stays hidden when the video is too long or too large for a post', async () => {
      validateVideoFull.mockResolvedValue({ valid: false, error: 'too long' })
      const { container } = render(<ShareToHomePrompt video={clip} onDone={vi.fn()} />)
      await vi.waitFor(() => expect(validateVideoFull).toHaveBeenCalledWith(clip))
      await Promise.resolve()
      expect(container.innerHTML).toBe('')
    })
  })
})
