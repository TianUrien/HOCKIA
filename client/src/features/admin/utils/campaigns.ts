import type { EmailCampaign } from '../types'

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function inferCampaignAudienceSource(campaign: Pick<EmailCampaign, 'audience_filter'> & { audience_source?: unknown }): 'users' | 'outreach' {
  if (campaign.audience_source === 'users' || campaign.audience_source === 'outreach') {
    return campaign.audience_source
  }

  const filter = campaign.audience_filter ?? {}
  const contactIds = filter.contact_ids

  if (Array.isArray(contactIds)) {
    return 'outreach'
  }

  if (hasString(filter.club) || hasString(filter.status)) {
    return 'outreach'
  }

  return 'users'
}

export function normalizeEmailCampaign(campaign: EmailCampaign): EmailCampaign {
  return {
    ...campaign,
    audience_source: inferCampaignAudienceSource(campaign),
  }
}

export function getCampaignDisplayRecipientCount(campaign: EmailCampaign): number {
  if (campaign.total_recipients > 0 || campaign.status !== 'draft') {
    return campaign.total_recipients
  }

  if (inferCampaignAudienceSource(campaign) !== 'outreach') {
    return campaign.total_recipients
  }

  const filter = campaign.audience_filter ?? {}
  const contactIds = Array.isArray(filter.contact_ids)
    ? filter.contact_ids.filter((value): value is string => hasString(value))
    : []

  return contactIds.length > 0 ? contactIds.length : campaign.total_recipients
}
