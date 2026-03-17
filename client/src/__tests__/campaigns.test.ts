import { describe, expect, it } from 'vitest'

import { getCampaignDisplayRecipientCount, inferCampaignAudienceSource, normalizeEmailCampaign } from '@/features/admin/utils/campaigns'
import type { EmailCampaign } from '@/features/admin/types'

function makeCampaign(overrides: Partial<EmailCampaign> = {}): EmailCampaign {
  return {
    id: 'campaign-1',
    template_id: 'template-1',
    template_key: 'club_intro',
    template_name: 'Club Intro',
    name: 'Test campaign',
    category: 'marketing',
    status: 'draft',
    audience_filter: null,
    target_role: null,
    target_country: null,
    scheduled_at: null,
    sent_at: null,
    total_recipients: 0,
    audience_source: 'users',
    created_by: 'admin-1',
    created_at: '2026-03-17T00:00:00Z',
    updated_at: '2026-03-17T00:00:00Z',
    total_sent: 0,
    total_delivered: 0,
    total_opened: 0,
    total_clicked: 0,
    total_count: 1,
    ...overrides,
  }
}

describe('campaign utils', () => {
  it('infers outreach campaigns from selected contact ids when audience_source is missing', () => {
    const source = inferCampaignAudienceSource({
      audience_filter: {
        contact_ids: ['contact-1', 'contact-2'],
      },
    })

    expect(source).toBe('outreach')
  })

  it('normalizes missing audience source for legacy outreach payloads', () => {
    const campaign = makeCampaign({
      audience_source: undefined as unknown as 'users',
      audience_filter: {
        contact_ids: ['contact-1'],
      },
    })

    expect(normalizeEmailCampaign(campaign).audience_source).toBe('outreach')
  })

  it('falls back to selected outreach contacts for draft recipient counts', () => {
    const campaign = makeCampaign({
      audience_source: 'outreach',
      audience_filter: {
        contact_ids: ['contact-1', 'contact-2', 'contact-3'],
      },
    })

    expect(getCampaignDisplayRecipientCount(campaign)).toBe(3)
  })

  it('preserves stored totals for non-draft campaigns', () => {
    const campaign = makeCampaign({
      status: 'sent',
      total_recipients: 12,
      audience_source: 'outreach',
      audience_filter: {
        contact_ids: ['contact-1', 'contact-2'],
      },
    })

    expect(getCampaignDisplayRecipientCount(campaign)).toBe(12)
  })
})
