// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'

// Rate limiting for delete-account endpoint (database-backed, survives cold starts)
const MAX_DELETE_ATTEMPTS = 3
const DELETE_WINDOW_SECONDS = 3600 // 1 hour

async function checkDeleteRateLimit(
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_identifier: userId,
      p_action_type: 'delete_account',
      p_max_requests: MAX_DELETE_ATTEMPTS,
      p_window_seconds: DELETE_WINDOW_SECONDS,
    })

    if (error) {
      console.error('[DELETE_ACCOUNT] Rate limit RPC error:', error)
      // Fail-closed for destructive operation
      return { allowed: false, retryAfter: 60 }
    }

    const result = data as { allowed: boolean; remaining: number; reset_at: string; limit: number }
    if (!result.allowed) {
      const resetAt = new Date(result.reset_at).getTime()
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      return { allowed: false, retryAfter }
    }

    return { allowed: true }
  } catch (err) {
    console.error('[DELETE_ACCOUNT] Rate limit check failed:', err)
    // Fail-closed for destructive operation
    return { allowed: false, retryAfter: 60 }
  }
}

interface DeleteAccountResponse {
  success: boolean
  error?: string
  correlationId?: string
  durationMs?: number
  status?: 'complete' | 'partial'
  warnings?: string[]
  deletedData?: {
    profiles: number
    messages: number
    archivedMessages?: number
    conversations: number
    applications: number
    playerMedia: number
    opportunityInboxState?: number
    clubMedia: number
    playingHistory: number
    vacancies: number
    storageFiles: number
    notifications?: number
    friendships?: number
    unreadCounters?: number
    references?: number
  }
}

type LogMeta = Record<string, unknown>

type SupabaseServerClient = SupabaseClient<any, any, any>

type StorageTarget = {
  bucket: string
  prefix: string
  label: string
}

const STORAGE_BUCKETS = ['avatars', 'gallery', 'club-media', 'player-media', 'journey', 'user-posts', 'brand-posts', 'brand-products'] as const
const STORAGE_PAGE_SIZE = 100
const DB_BATCH_SIZE = 2000
const DELETE_RELATIONS_FUNCTION = 'hard_delete_profile_relations'

const createLogger = (correlationId: string) => ({
  info: (message: string, meta?: LogMeta) => console.log(`[DELETE_ACCOUNT][${correlationId}] ${message}`, meta ?? ''),
  warn: (message: string, meta?: LogMeta) => console.warn(`[DELETE_ACCOUNT][${correlationId}] ${message}`, meta ?? ''),
  error: (message: string, meta?: LogMeta) => console.error(`[DELETE_ACCOUNT][${correlationId}] ${message}`, meta ?? ''),
})

// Sanitize error messages for client - don't leak internal implementation details
const sanitizeErrorMessage = (message?: string): string => {
  const knownErrors: Record<string, string> = {
    'Invalid or expired token': 'Session expired. Please log in again.',
    'Missing authorization header': 'Authentication required.',
    'Invalid authorization token': 'Authentication required.',
    'Supabase credentials are not configured': 'Service temporarily unavailable. Please try again later.',
    'Failed to delete profile data': 'Unable to complete deletion. Please try again.',
    'Failed to delete auth user': 'Unable to complete deletion. Please try again.',
  }

  return knownErrors[message || ''] || 'An unexpected error occurred. Please try again.'
}

const sanitizeBearerToken = (authHeader: string | null): string => {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing authorization header')
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    throw new Error('Invalid authorization token')
  }

  return token
}

const normalizePrefix = (prefix: string): string => prefix.replace(/^\/+/, '').replace(/\/+$/, '')

const getStorageTargets = (userId: string): StorageTarget[] =>
  STORAGE_BUCKETS.map((bucket) => ({
    bucket,
    prefix: userId,
    label: bucket,
  }))

const deleteStoragePrefix = async (client: SupabaseServerClient, target: StorageTarget): Promise<number> => {
  const normalizedPrefix = normalizePrefix(target.prefix)
  if (!normalizedPrefix) {
    return 0
  }

  const objectsToDelete: string[] = []

  const collectObjects = async (path: string) => {
    let offset = 0

    while (true) {
      const { data, error } = await client.storage.from(target.bucket).list(path, {
        limit: STORAGE_PAGE_SIZE,
        offset,
      })

      if (error) {
        if (isMissingStorageFolder(error)) {
          return
        }
        throw error
      }

      if (!data || data.length === 0) {
        break
      }

      for (const entry of data) {
        const nextPath = path ? `${path}/${entry.name}` : entry.name
        if ((entry as { id?: string | null }).id) {
          objectsToDelete.push(nextPath)
        } else {
          await collectObjects(nextPath)
        }
      }

      if (data.length < STORAGE_PAGE_SIZE) {
        break
      }

      offset += STORAGE_PAGE_SIZE
    }
  }

  await collectObjects(normalizedPrefix)

  if (objectsToDelete.length === 0) {
    return 0
  }

  let removed = 0
  for (let index = 0; index < objectsToDelete.length; index += STORAGE_PAGE_SIZE) {
    const chunk = objectsToDelete.slice(index, index + STORAGE_PAGE_SIZE)
    const { error: removeError } = await client.storage.from(target.bucket).remove(chunk)
    if (removeError) {
      throw removeError
    }
    removed += chunk.length
  }

  return removed
}

const isMissingStorageFolder = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybeError = error as { message?: string; statusCode?: number | string }
  if (maybeError.statusCode === 404 || maybeError.statusCode === '404') {
    return true
  }

  return Boolean(maybeError.message?.toLowerCase().includes('not found'))
}

const applyDeletionSummary = (
  deletedData: NonNullable<DeleteAccountResponse['deletedData']>,
  summary?: Record<string, number | null>
) => {
  if (!summary) {
    return
  }

  const pick = (key: string): number => Number(summary[key] ?? 0)

  deletedData.applications = pick('applications')
  deletedData.vacancies = pick('vacancies')
  deletedData.playingHistory = pick('playingHistory')
  deletedData.playerMedia = pick('galleryPhotos')
  deletedData.clubMedia = pick('clubMedia')
  deletedData.messages = pick('messages')
  deletedData.conversations = pick('conversations')
  deletedData.profiles = pick('profiles')

  const archived = pick('archivedMessages')
  if (archived > 0) {
    deletedData.archivedMessages = archived
  }

  const notifications = pick('profileNotifications')
  if (notifications > 0) {
    deletedData.notifications = notifications
  }

  const friendships = pick('friendships')
  if (friendships > 0) {
    deletedData.friendships = friendships
  }

  const references = pick('profileReferences')
  if (references > 0) {
    deletedData.references = references
  }

  const unreadCounters = pick('unreadCounters')
  if (unreadCounters > 0) {
    deletedData.unreadCounters = unreadCounters
  }

  const opportunityInboxState = pick('opportunityInboxState')
  if (opportunityInboxState > 0) {
    deletedData.opportunityInboxState = opportunityInboxState
  }
}

const enqueueStorageCleanupFallback = async (
  client: SupabaseServerClient,
  bucket: string,
  prefix: string,
  logger: ReturnType<typeof createLogger>
) => {
  try {
    const { data, error } = await client.rpc('enqueue_storage_objects_for_prefix', {
      p_bucket: bucket,
      p_prefix: prefix,
      p_reason: 'delete_account_fallback'
    })

    if (error) {
      throw error
    }

    return Number(data ?? 0)
  } catch (error) {
    logger.warn('Failed to enqueue storage cleanup fallback', { bucket, prefix, error })
    return 0
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      headers,
      status: 405,
    })
  }

  const correlationId = crypto.randomUUID()
  const logger = createLogger(correlationId)
  const startedAt = performance.now()

  try {
    const token = sanitizeBearerToken(req.headers.get('Authorization'))

    const supabase = getServiceClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      throw new Error('Invalid or expired token')
    }

    // Rate limiting check (database-backed, survives cold starts)
    const rateCheck = await checkDeleteRateLimit(supabase, user.id)
    if (!rateCheck.allowed) {
      logger.warn('Rate limit exceeded for delete-account', { userId: user.id })
      const response: DeleteAccountResponse = {
        success: false,
        error: 'Too many delete attempts. Please try again later.',
        correlationId,
      }
      return new Response(JSON.stringify(response), {
        headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter) },
        status: 429,
      })
    }

    logger.info('Beginning account deletion', { userId: user.id })

    const deletedData: NonNullable<DeleteAccountResponse['deletedData']> = {
      profiles: 0,
      messages: 0,
      conversations: 0,
      applications: 0,
      playerMedia: 0,
      clubMedia: 0,
      playingHistory: 0,
      vacancies: 0,
      storageFiles: 0,
    }

    const warnings: string[] = []

    for (const target of getStorageTargets(user.id)) {
      try {
        const removed = await deleteStoragePrefix(supabase, target)
        if (removed > 0) {
          deletedData.storageFiles += removed
          logger.info('Removed storage files', { bucket: target.bucket, removed })
        }
      } catch (storageError) {
        logger.warn('Storage cleanup failed', { bucket: target.bucket, error: storageError })
        const normalizedPrefix = normalizePrefix(target.prefix)
        const queued = await enqueueStorageCleanupFallback(supabase, target.bucket, normalizedPrefix, logger)
        if (queued > 0) {
          warnings.push(`Queued ${queued} ${target.bucket}/${normalizedPrefix} objects for async cleanup`)
        } else {
          warnings.push(`Failed to purge ${target.bucket}/${target.prefix}`)
        }
      }
    }

    try {
      const { data, error } = await supabase.rpc(DELETE_RELATIONS_FUNCTION, {
        p_user_id: user.id,
        p_batch: DB_BATCH_SIZE,
      })

      if (error) {
        throw error
      }

      applyDeletionSummary(deletedData, data ?? undefined)
      logger.info('Relational cleanup complete', { counts: data })
    } catch (dbError) {
      logger.error('Database cleanup failed', { error: dbError })
      throw new Error('Failed to delete profile data')
    }

    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id)
    if (deleteUserError) {
      logger.error('Auth deletion failed', { error: deleteUserError })
      throw new Error('Failed to delete auth user')
    }

    const durationMs = Math.round(performance.now() - startedAt)
    logger.info('Account deletion completed', { durationMs, warnings })

    const success = warnings.length === 0

    const response: DeleteAccountResponse = {
      success,
      correlationId,
      durationMs,
      status: success ? 'complete' : 'partial',
      warnings: warnings.length ? warnings : undefined,
      deletedData,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
      status: 200,
    })
  } catch (error: any) {
    logger.error('Delete-account error', { error })
    captureException(error, { functionName: 'delete-account', correlationId })

    // Sanitize error messages for client - don't leak internal details
    const sanitizedError = sanitizeErrorMessage(error?.message)

    const response: DeleteAccountResponse = {
      success: false,
      error: sanitizedError,
      correlationId,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
      status: 400,
    })
  }
})
