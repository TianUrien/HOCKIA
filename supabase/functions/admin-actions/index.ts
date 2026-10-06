// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import { deleteStreamAssets } from '../_shared/cloudflare-stream.ts'

// UUID format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AdminActionRequest {
  action: 'delete_auth_user' | 'set_admin_status'
  target_id: string
  params?: Record<string, any>
}

interface AdminActionResponse {
  success: boolean
  error?: string
  data?: any
}

const createLogger = (correlationId: string) => ({
  info: (message: string, meta?: Record<string, unknown>) => 
    console.log(`[ADMIN_ACTIONS][${correlationId}] ${message}`, meta ?? ''),
  warn: (message: string, meta?: Record<string, unknown>) => 
    console.warn(`[ADMIN_ACTIONS][${correlationId}] ${message}`, meta ?? ''),
  error: (message: string, meta?: Record<string, unknown>) => 
    console.error(`[ADMIN_ACTIONS][${correlationId}] ${message}`, meta ?? ''),
})

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger(correlationId)
  const startTime = Date.now()
  
  // Get CORS headers with origin validation
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers })
  }

  try {
    // Validate method
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Get authorization header
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.slice(7)

    // Create Supabase clients
    // User client to verify the caller (per-request — needs caller's auth token)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    // Service role client for admin operations (shared singleton)
    const adminClient = getServiceClient()

    // Verify the caller is authenticated
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) {
      logger.error('Authentication failed', { error: authError?.message })
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the caller is an admin
    const { data: isAdmin, error: adminCheckError } = await userClient.rpc('is_platform_admin')
    if (adminCheckError || !isAdmin) {
      logger.error('Admin check failed', { userId: user.id, isAdmin, error: adminCheckError?.message })
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Admin access required' }),
        { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Admin authenticated', { adminId: user.id })

    // Rate limiting: 20 admin actions per minute (database-backed)
    try {
      const { data: rateData, error: rateError } = await adminClient.rpc('check_rate_limit', {
        p_identifier: user.id,
        p_action_type: 'admin_action',
        p_max_requests: 20,
        p_window_seconds: 60,
      })

      if (rateError) {
        logger.error('Rate limit RPC error', { error: rateError.message })
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit check failed. Please try again.' }),
          { status: 503, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      const rateResult = rateData as { allowed: boolean; remaining: number; reset_at: string }
      if (!rateResult.allowed) {
        const resetAt = new Date(rateResult.reset_at).getTime()
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        logger.warn('Rate limit exceeded', { adminId: user.id })
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please slow down.' }),
          { status: 429, headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) } }
        )
      }
    } catch (rateLimitErr) {
      logger.error('Rate limit check failed', { error: rateLimitErr })
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit check failed. Please try again.' }),
        { status: 503, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: AdminActionRequest = await req.json()
    const { action, target_id, params } = body

    if (!action || !target_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: action, target_id' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Validate target_id is a valid UUID
    if (!UUID_REGEX.test(target_id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid target_id format' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    let result: AdminActionResponse

    switch (action) {
      case 'delete_auth_user': {
        logger.info('Deleting auth user', { targetId: target_id })
        
        // First check if the user exists
        const { data: targetUser, error: fetchError } = await adminClient.auth.admin.getUserById(target_id)
        if (fetchError || !targetUser) {
          logger.warn('Target user not found', { targetId: target_id })
          result = { success: false, error: 'User not found' }
          break
        }

        // Cloudflare Stream assets first: removing the auth user cascades the
        // player_videos rows that carry the uids. Best-effort, never blocks.
        try {
          const { data: videos, error: videosError } = await adminClient
            .from('player_videos')
            .select('cf_uid')
            .eq('user_id', target_id)
            .not('cf_uid', 'is', null)
          if (videosError) throw videosError
          const uids = (videos ?? []).map((v: { cf_uid: string | null }) => v.cf_uid)
          if (uids.length > 0) {
            const counts = await deleteStreamAssets(uids, '[admin-actions]')
            logger.info('Cloudflare Stream cleanup', { targetId: target_id, ...counts })
          }
        } catch (streamError) {
          logger.warn('Cloudflare Stream cleanup failed', { targetId: target_id, error: String(streamError) })
        }

        // Delete the user
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(target_id)
        if (deleteError) {
          logger.error('Failed to delete user', { targetId: target_id, error: deleteError.message })
          result = { success: false, error: deleteError.message }
          break
        }

        // Log the action
        await userClient.rpc('admin_log_action', {
          p_action: 'delete_auth_user',
          p_target_type: 'auth_user',
          p_target_id: target_id,
          p_old_data: {
            email: targetUser.user.email,
            created_at: targetUser.user.created_at,
          },
          p_new_data: null,
          p_metadata: { reason: params?.reason ?? 'Orphan cleanup' },
        })

        logger.info('Auth user deleted successfully', { targetId: target_id })
        result = { 
          success: true, 
          data: { 
            deleted_user_id: target_id,
            email: targetUser.user.email 
          } 
        }
        break
      }

      case 'set_admin_status': {
        const isAdmin = params?.is_admin ?? false
        logger.info('Setting admin status', { targetId: target_id, isAdmin })

        // Update user's app_metadata
        const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
          target_id,
          { app_metadata: { is_admin: isAdmin } }
        )

        if (updateError) {
          logger.error('Failed to update admin status', { targetId: target_id, error: updateError.message })
          result = { success: false, error: updateError.message }
          break
        }

        // Log the action
        await userClient.rpc('admin_log_action', {
          p_action: isAdmin ? 'grant_admin' : 'revoke_admin',
          p_target_type: 'auth_user',
          p_target_id: target_id,
          p_old_data: null,
          p_new_data: { is_admin: isAdmin },
          p_metadata: { reason: params?.reason },
        })

        logger.info('Admin status updated successfully', { targetId: target_id, isAdmin })
        result = { 
          success: true, 
          data: { 
            user_id: target_id,
            is_admin: isAdmin,
            email: updatedUser.user.email
          } 
        }
        break
      }

      default:
        result = { success: false, error: `Unknown action: ${action}` }
    }

    const durationMs = Date.now() - startTime
    logger.info('Request completed', { action, durationMs, success: result.success })

    return new Response(
      JSON.stringify(result),
      { 
        status: result.success ? 200 : 400, 
        headers: { ...headers, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'admin-actions', correlationId })

    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
