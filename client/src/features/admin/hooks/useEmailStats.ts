import { useState, useEffect, useCallback } from 'react'
import {
  getEmailOverview,
  getEmailTemplates,
  getEmailCampaigns,
  getEmailEngagementExplorer,
  previewCampaignAudience,
  getEmailContactsSummary,
  getEmailContacts,
} from '../api/adminApi'
import type {
  EmailOverviewStats,
  EmailTemplate,
  EmailCampaign,
  EmailEngagementItem,
  EmailEngagementSearchParams,
  AudiencePreview,
  EmailContactsSummary,
  EmailContact,
  EmailContactSearchParams,
} from '../types'
import { logger } from '@/lib/logger'

export function useEmailOverview(days: number) {
  const [data, setData] = useState<EmailOverviewStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailOverview(days)
      setData(result)
    } catch (err) {
      logger.error('[useEmailOverview] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load email overview')
    } finally {
      setIsLoading(false)
    }
  }, [days])

  useEffect(() => { fetch() }, [fetch])

  return { data, isLoading, error, refetch: fetch }
}

export function useEmailTemplates() {
  const [data, setData] = useState<EmailTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailTemplates()
      setData(result)
    } catch (err) {
      logger.error('[useEmailTemplates] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load email templates')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { data, isLoading, error, refetch: fetch }
}

export function useEmailCampaigns(params: { status?: string; limit?: number; offset?: number } = {}) {
  const [data, setData] = useState<EmailCampaign[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailCampaigns(params)
      setData(result.campaigns)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[useEmailCampaigns] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load campaigns')
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tracking individual fields, not the params object
  }, [params.status, params.limit, params.offset])

  useEffect(() => { fetch() }, [fetch])

  return { data, totalCount, isLoading, error, refetch: fetch }
}

export function useEmailEngagement(params: EmailEngagementSearchParams = {}) {
  const [data, setData] = useState<EmailEngagementItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailEngagementExplorer(params)
      setData(result.items)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[useEmailEngagement] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load engagement data')
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tracking individual fields, not the params object
  }, [params.template_key, params.status, params.role, params.country, params.since, params.until, params.limit, params.offset])

  useEffect(() => { fetch() }, [fetch])

  return { data, totalCount, isLoading, error, refetch: fetch }
}

export function useEmailContactsSummary() {
  const [data, setData] = useState<EmailContactsSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailContactsSummary()
      setData(result)
    } catch (err) {
      logger.error('[useEmailContactsSummary] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load contacts summary')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { data, isLoading, error, refetch: fetch }
}

export function useEmailContacts(params: EmailContactSearchParams = {}) {
  const [data, setData] = useState<EmailContact[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getEmailContacts(params)
      setData(result.contacts)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[useEmailContacts] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tracking individual fields
  }, [params.role, params.country, params.search, params.limit, params.offset])

  useEffect(() => { fetch() }, [fetch])

  return { data, totalCount, isLoading, error, refetch: fetch }
}

export function useAudiencePreview() {
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPreview = useCallback(async (category: string, audienceFilter: { role?: string; country?: string }) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await previewCampaignAudience(category, audienceFilter)
      setPreview(result)
    } catch (err) {
      logger.error('[useAudiencePreview] Failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to preview audience')
      setPreview(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setPreview(null)
    setError(null)
  }, [])

  return { preview, isLoading, error, fetchPreview, reset }
}
