/**
 * Metric explainer config — benchmark classification pins.
 *
 * The founder dashboard's tooltips classify live values into benchmark
 * tiers (Weak/Average/Good/Excellent). These tests pin the band edges so a
 * config edit can't silently shift what the dashboard tells the founder,
 * and enforce structural invariants every explainer must hold.
 */

import { describe, it, expect } from 'vitest'
import { METRIC_INFO, classifyMetric, type MetricExplainer, type MetricKey } from '@/features/admin/lib/metricInfo'

describe('metricInfo benchmarks', () => {
  it('classifies the documented stickiness example correctly (42.6% → Good)', () => {
    expect(classifyMetric(METRIC_INFO.stickiness, 42.6)?.tier).toBe('good')
  })

  it('band edges belong to the higher tier (boundary values)', () => {
    const s = METRIC_INFO.stickiness
    expect(classifyMetric(s, 24.9)?.tier).toBe('poor')
    expect(classifyMetric(s, 25)?.tier).toBe('average')
    expect(classifyMetric(s, 35)?.tier).toBe('good')
    expect(classifyMetric(s, 55)?.tier).toBe('excellent')
    expect(classifyMetric(s, 100)?.tier).toBe('excellent')
  })

  it('metrics without benchmarks return null (absolute counts)', () => {
    expect(classifyMetric(METRIC_INFO.dau, 3)).toBeNull()
    expect(classifyMetric(METRIC_INFO.newUsers, 45)).toBeNull()
  })

  it('every explainer has the four explanation fields non-empty', () => {
    for (const key of Object.keys(METRIC_INFO) as MetricKey[]) {
      const m = METRIC_INFO[key]
      expect(m.title, key).toBeTruthy()
      expect(m.measures, key).toBeTruthy()
      expect(m.formula, key).toBeTruthy()
      expect(m.why, key).toBeTruthy()
    }
  })

  it('benchmark bands are ascending and start at 0', () => {
    for (const key of Object.keys(METRIC_INFO) as MetricKey[]) {
      const bands = (METRIC_INFO[key] as MetricExplainer).benchmarks
      if (!bands) continue
      expect(bands[0].min, key).toBe(0)
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].min, `${key}[${i}]`).toBeGreaterThan(bands[i - 1].min)
      }
    }
  })
})
