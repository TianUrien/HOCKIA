/**
 * Product Health Score types — mirrors compute_product_health_score()
 * JSON output. The PL/pgSQL function returns 0–100 scores per loop, plus
 * diagnostic raw metrics so the UI can show "what's driving this".
 */

export type ProductHealthTier =
  | 'critical'  // 0–19
  | 'weak'      // 20–39
  | 'building'  // 40–59
  | 'working'   // 60–79
  | 'excellent' // 80–100

export type LoopName =
  | 'recruitment'
  | 'network'
  | 'retention'
  | 'role_balance'
  | 'activation'
  | 'content'

export interface SubScore {
  score: number
  weight: number
}

export interface ProductHealthDiagnostics {
  baseline: {
    real_profiles: number
    active_users_7d: number
    active_users_30d: number
  }
  recruitment: {
    opportunities_30d: number
    opportunities_with_view: number
    opportunities_with_apps: number
    applications_30d: number
    applications_reviewed_30d: number
    tiers_5_6_measured: boolean
  }
  network: {
    reciprocal_cross_role_7d: number
    reciprocal_same_role_7d: number
    friendships_accepted_30d: number
    references_accepted_30d: number
    friend_accept_rate_pct: number | null
  }
  retention: {
    meaningful_w1_pct: number
    meaningful_w4_pct: number
    dau_mau_stickiness: number
    hv_actions_per_user_7d: number
    w1_cohort_known: boolean
    w4_cohort_known: boolean
  }
  role_balance: {
    lowest_role_pct: number
    cross_role_interaction_pct: number
    evenness: number
  }
  activation: {
    signups_30d: number
    activated_in_7d: number
    activation_rate_pct: number | null
  }
  content: {
    posts_per_active_user_7d: number
    posts_with_comment_pct: number
    refs_given_per_user_30d: number
    low_data_confidence: boolean
  }
}

export interface ProductHealthScore {
  overall_score: number
  tier: ProductHealthTier
  computed_at: string
  window: string
  sub_scores: Record<LoopName, SubScore>
  diagnostics: ProductHealthDiagnostics
  bottleneck: {
    loop: LoopName
    score: number
    weight: number
  }
}
