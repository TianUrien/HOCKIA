/**
 * Advanced Analytics API Module
 *
 * Functions for querying feed, notification, funnel, community, and marketplace analytics.
 * All functions require the caller to be an admin.
 */

import { supabase } from '@/lib/supabase'
import type {
  FeedAnalytics,
  NotificationEffectiveness,
  ConversionFunnels,
  CommunityAnalytics,
  MarketplaceHealth,
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

export async function getFeedAnalytics(days = 30): Promise<FeedAnalytics> {
  const { data, error } = await adminRpc('admin_get_feed_analytics', { p_days: days })
  if (error) throw new Error(`Failed to get feed analytics: ${error.message}`)
  return data as FeedAnalytics
}

export async function getNotificationEffectiveness(days = 30): Promise<NotificationEffectiveness> {
  const { data, error } = await adminRpc('admin_get_notification_effectiveness', { p_days: days })
  if (error) throw new Error(`Failed to get notification effectiveness: ${error.message}`)
  return data as NotificationEffectiveness
}

export async function getConversionFunnels(days = 30): Promise<ConversionFunnels> {
  const { data, error } = await adminRpc('admin_get_conversion_funnels', { p_days: days })
  if (error) throw new Error(`Failed to get conversion funnels: ${error.message}`)
  return data as ConversionFunnels
}

export async function getCommunityAnalytics(days = 30): Promise<CommunityAnalytics> {
  const { data, error } = await adminRpc('admin_get_community_analytics', { p_days: days })
  if (error) throw new Error(`Failed to get community analytics: ${error.message}`)
  return data as CommunityAnalytics
}

export async function getMarketplaceHealth(days = 30): Promise<MarketplaceHealth> {
  const { data, error } = await adminRpc('admin_get_marketplace_health', { p_days: days })
  if (error) throw new Error(`Failed to get marketplace health: ${error.message}`)
  return data as MarketplaceHealth
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOnboardingFunnelDetail(days = 30, role?: string): Promise<any> {
  const params: Record<string, unknown> = { p_days: days }
  if (role) params.p_role = role
  const { data, error } = await adminRpc('admin_get_onboarding_funnel_detail', params)
  if (error) throw new Error(`Failed to get onboarding funnel: ${error.message}`)
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSearchQuality(days = 30): Promise<any> {
  const { data, error } = await adminRpc('admin_get_search_quality', { p_days: days })
  if (error) throw new Error(`Failed to get search quality: ${error.message}`)
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMessagingHealth(days = 30): Promise<any> {
  const { data, error } = await adminRpc('admin_get_messaging_health', { p_days: days })
  if (error) throw new Error(`Failed to get messaging health: ${error.message}`)
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCrossFeatureAttribution(days = 30, windowHours = 24): Promise<any> {
  const { data, error } = await adminRpc('admin_get_cross_feature_attribution', { p_days: days, p_window_hours: windowHours })
  if (error) throw new Error(`Failed to get attribution: ${error.message}`)
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getChurnAnalysis(days = 30): Promise<any> {
  const { data, error } = await adminRpc('admin_get_churn_analysis', { p_days: days })
  if (error) throw new Error(`Failed to get churn analysis: ${error.message}`)
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRetentionByRole(cohortWeeks = 8): Promise<any> {
  const { data, error } = await adminRpc('admin_get_retention_by_role', { p_cohort_weeks: cohortWeeks })
  if (error) throw new Error(`Failed to get retention by role: ${error.message}`)
  return data
}
