// Spanish copy for application-feedback (Stage 3, 2026-11-16). The English
// copy stays in application-feedback/index.ts, unchanged; this mirrors it
// sentence for sentence (client/src/locales/glossary.md: "Esta vez no" for
// "Not this time", no second-person verb forms, no generic masculine, never
// promise outcomes). Kept in _shared so the deno suite covers it.

import { spanishPositionLabel } from './member-language.ts'
import { SPANISH_OUTPUT_INSTRUCTION } from './ai-language.ts'

/** Extra rule for Spanish prompts: the agreed words for the outcome. */
export const FEEDBACK_SPANISH_RULE = [
  SPANISH_OUTPUT_INSTRUCTION,
  '- "Not this time" is "Esta vez no". Never "rechazado/a", "descartado/a" or "no seleccionado/a".',
  '- The JSON key stays "message".',
].join('\n')

/** Harsh Spanish terms (checked on Spanish answers on top of the English list). */
export const BANNED_ES = [
  'no es suficiente', 'no alcanza el nivel', 'fracaso', 'incompetente',
  'mediocre', 'patétic', 'inútil', 'rechazad', 'descartad',
]

export function reasonCopyEs(reason: string | null): string | null {
  switch (reason) {
    case 'position_filled':
      return 'Parece que el puesto ya está cubierto. Es una cuestión de momento, no de nivel. Las oportunidades que todavía buscan tu puesto pueden encajar mejor.'
    case 'different_position':
      return 'Para esta oportunidad se prioriza otro puesto. Las oportunidades para tu puesto probablemente encajen mejor.'
    case 'different_level':
      return 'Para esta oportunidad se busca otro nivel. Vale la pena seguir completando el perfil y sumando experiencia comprobable.'
    case 'timing':
      return 'Los tiempos o la disponibilidad no coincidieron esta vez. Vale la pena tener en cuenta a este club para más adelante.'
    case 'location':
      return 'La ubicación o el traslado no funcionó para esta oportunidad.'
    case 'eligibility':
      return 'Hubo una cuestión de pasaporte o elegibilidad propia de esta oportunidad.'
    case 'profile_incomplete':
      return 'Sumar más detalle al perfil puede ayudar a que los clubes te conozcan más rápido la próxima vez.'
    case 'video_missing':
      return 'Los clubes suelen pedir videos antes de avanzar. Un video con jugadas destacadas o un partido completo puede fortalecer próximas postulaciones.'
    default:
      return null
  }
}

export interface FeedbackCtx {
  status: string
  reason: string | null
  position: string
  clubName: string
}

export function fallbackMessageEs(ctx: FeedbackCtx): string {
  const reason = reasonCopyEs(ctx.reason)
  switch (ctx.status) {
    case 'shortlisted':
      return `Buenas noticias: ${ctx.clubName} te sumó a la preselección para ${ctx.position}. Hay interés; conviene mantener el perfil al día durante la revisión.`
    case 'maybe':
      return reason
        ? `${ctx.clubName} todavía está considerando tu postulación para ${ctx.position}. ${reason}`
        : `${ctx.clubName} todavía está considerando tu postulación para ${ctx.position}. Aún no hay una decisión.`
    case 'rejected':
      return reason
        ? `Esta vez no para ${ctx.position}. ${reason} Hay más oportunidades por delante.`
        : `Esta vez no para ${ctx.position}. Suele ser una cuestión de encaje, no de capacidad. Vale la pena seguir postulándose.`
    default:
      return `Tu postulación para ${ctx.position} está enviada y en espera de revisión.`
  }
}

export function clubFallbackMessageEs(ctx: FeedbackCtx): string {
  const why: Record<string, string> = {
    position_filled: 'ya cubrimos el puesto',
    different_position: 'priorizamos otro puesto para este plantel',
    different_level: 'buscamos otro nivel de juego para este plantel',
    timing: 'los tiempos y la disponibilidad no coincidieron esta temporada',
    location: 'la ubicación o el traslado no funcionó para esta oportunidad',
    eligibility: 'había un requisito de pasaporte o elegibilidad para esta oportunidad',
    profile_incomplete: 'necesitábamos más detalle en tu perfil para avanzar',
    video_missing: 'necesitábamos videos de partidos para avanzar',
  }
  const reason = ctx.reason ? why[ctx.reason] : null
  const next = ctx.reason === 'video_missing' || ctx.reason === 'different_level'
    ? ' Conviene mantener los partidos completos al día para oportunidades similares.'
    : ctx.reason === 'profile_incomplete' ? ' Un perfil más completo ayuda a que los clubes te conozcan más rápido.' : ''
  return reason
    ? `Gracias por postularte a ${ctx.position} en ${ctx.clubName}. Esta vez no, porque ${reason}.${next}`
    : `Gracias por postularte a ${ctx.position} en ${ctx.clubName}. Esta vez no, pero valoramos tu interés.`
}

/** The position enum in Spanish ('goalkeeper' → 'Arquero/a'); unknown tokens title-cased. */
export function humanizePositionEs(pos: string | null | undefined): string | null {
  if (!pos) return null
  return spanishPositionLabel(pos) ?? pos.split('_').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}
