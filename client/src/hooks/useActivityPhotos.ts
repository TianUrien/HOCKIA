import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryKeys'

/**
 * The full set of photos behind a Home "Added N new photos" card. The card
 * only carries up to 4 sample URLs; the rollup is keyed by (uploader, UTC
 * day of gallery_photos.created_at), so the set is that member's gallery
 * photos created that day, oldest first — the same order the samples use.
 * Fetched only once the card nears the viewport or the viewer opens.
 *
 * Cards that become visible in the same scroll tick share ONE request
 * (Sentry JAVASCRIPT-REACT-D7: one gallery_photos call per card on Home):
 * `fetchActivityPhotos` queues the (uploader, day) pairs for a few ms, runs a
 * single `user_id IN (…)` query over the widest day window, and splits the
 * rows per pair. Each card keeps its own React Query cache entry.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const BATCH_WAIT_MS = 25
const BATCH_MAX = 50

type Pair = { uploaderId: string; day: string }
type Pending = Pair & { resolve: (urls: string[]) => void; reject: (err: unknown) => void }
type Row = { user_id: string; photo_url: string | null; created_at: string }

const queue: Pending[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function dayWindow(day: string): { start: string; end: string } {
  const start = `${day}T00:00:00Z`
  const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString()
  return { start, end }
}

/** Rows → the URL list of one (uploader, day) pair, oldest first. Pure. */
export function photosForPair(rows: Row[], pair: Pair): string[] {
  const { start, end } = dayWindow(pair.day)
  return rows
    .filter((r) => r.user_id === pair.uploaderId && r.created_at >= start && r.created_at < end)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => r.photo_url)
    .filter((u): u is string => Boolean(u))
}

async function flush(): Promise<void> {
  timer = null
  const batch = queue.splice(0, BATCH_MAX)
  if (queue.length > 0) timer = setTimeout(() => { void flush() }, 0)
  if (batch.length === 0) return
  const ids = Array.from(new Set(batch.map((p) => p.uploaderId)))
  const starts = batch.map((p) => dayWindow(p.day).start).sort()
  const ends = batch.map((p) => dayWindow(p.day).end).sort()
  try {
    const { data, error } = await supabase
      .from('gallery_photos')
      .select('user_id, photo_url, created_at')
      .in('user_id', ids)
      .gte('created_at', starts[0])
      .lt('created_at', ends[ends.length - 1])
      .order('created_at', { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as Row[]
    for (const p of batch) p.resolve(photosForPair(rows, p))
  } catch (err) {
    for (const p of batch) p.reject(err)
  }
}

/** One (uploader, day) set, batched with every other request made in the same tick. */
export function fetchActivityPhotos(uploaderId: string, day: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    queue.push({ uploaderId, day, resolve, reject })
    if (!timer) timer = setTimeout(() => { void flush() }, BATCH_WAIT_MS)
  })
}

export function useActivityPhotos(uploaderId: string, day: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.activityPhotos(uploaderId, day),
    enabled: enabled && Boolean(uploaderId) && DAY_RE.test(day),
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchActivityPhotos(uploaderId, day),
  })
}
