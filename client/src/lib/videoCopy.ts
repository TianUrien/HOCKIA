/** "4:03" / "68:12" — minutes:seconds, floored (durations can be floats). */
export function formatVideoDuration(s: number | null | undefined): string | null {
  if (!s || s <= 0) return null
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
