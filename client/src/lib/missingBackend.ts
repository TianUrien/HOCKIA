/**
 * "This RPC / table isn't deployed yet" detection.
 *
 * D2 screens ship ahead of their migrations on some environments (a branch
 * previewed against staging before the data layer is applied). A missing
 * function or table must read as "not available yet" — the screen falls back
 * or hides the part — never as a crash or an error toast.
 *
 *  - PGRST202: PostgREST can't find the function in its schema cache (HTTP 404)
 *  - PGRST205: PostgREST can't find the table / view (HTTP 404)
 *  - 42883:    undefined_function (raised from inside SQL)
 *  - 42P01:    undefined_table
 */
const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])

export function isMissingBackendError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; status?: unknown; message?: unknown }
  if (typeof e.code === 'string' && MISSING_CODES.has(e.code)) return true
  if (e.status === 404) return true
  const message = typeof e.message === 'string' ? e.message : ''
  return /could not find the (function|table)/i.test(message)
}
