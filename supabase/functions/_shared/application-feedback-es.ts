// Spanish copy for application-feedback (Stage 3, 2026-11-16). The English
// copy stays in application-feedback/index.ts, unchanged; this mirrors it
// sentence for sentence (client/src/locales/glossary.md: "Esta vez no" for
// "Not this time", tú to the player, no generic masculine, never
// promise outcomes). Kept in _shared so the deno suite covers it.

import { spanishPositionLabel } from './member-language.ts'
import { SPANISH_OUTPUT_INSTRUCTION } from './ai-language.ts'

/** Extra rule for Spanish prompts: the agreed words for the outcome. */
export const FEEDBACK_SPANISH_RULE = [
  SPANISH_OUTPUT_INSTRUCTION,
  '- The base rules above stay. In Spanish, "you" (the player) is "tú": "te", "tu", "tu postulación", verbs in tú ("puedes", "sigue"). The club voice ("we") is the first person plural: "Te agradecemos", "Esta vez no avanzamos con tu postulación". Never "usted" and never voseo.',
  '- "Not this time" is "Esta vez no". Never "rechazado/a", "descartado/a" or "no seleccionado/a".',
  '- Example (player status): "Esta vez no: tu postulación para Volante no avanzó. Suele ser una cuestión de encaje, no de capacidad, y hay más oportunidades por delante."',
  '- Example (club note): "Gracias por postularte a Arquero/a en Club Atlético. Esta vez no avanzamos, porque ya cubrimos el lugar. Te deseamos lo mejor en la temporada."',
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
      return 'Parece que el lugar ya está cubierto. Es una cuestión de momento, no de nivel. Las oportunidades que todavía buscan tu posición pueden encajar mejor.'
    case 'different_position':
      return 'Para esta oportunidad se prioriza otra posición. Las oportunidades para tu posición probablemente encajen mejor.'
    case 'different_level':
      return 'Para esta oportunidad se busca otro nivel. Sigue completando tu perfil y sumando experiencia comprobable.'
    case 'timing':
      return 'Los tiempos o la disponibilidad no coincidieron esta vez. Vale la pena que tengas en cuenta a este club para más adelante.'
    case 'location':
      return 'La ubicación o la mudanza no resultaron compatibles con esta oportunidad.'
    case 'eligibility':
      return 'Hubo una cuestión de pasaporte o elegibilidad propia de esta oportunidad.'
    case 'profile_incomplete':
      return 'Sumar más detalle a tu perfil puede ayudar a que los clubes te conozcan más rápido la próxima vez.'
    case 'video_missing':
      return 'Los clubes suelen pedir videos antes de avanzar. Un video de highlights o de un partido completo puede fortalecer tus próximas postulaciones.'
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
      return `Buenas noticias: ${ctx.clubName} te sumó a su preselección para ${ctx.position}. Hay interés; mantén tu perfil al día mientras revisan.`
    case 'maybe':
      return reason
        ? `${ctx.clubName} todavía está considerando tu postulación para ${ctx.position}. ${reason}`
        : `${ctx.clubName} todavía está considerando tu postulación para ${ctx.position}. Aún no hay una decisión, así que espera un poco más.`
    case 'rejected':
      return reason
        ? `Esta vez no: tu postulación para ${ctx.position} no avanzó. ${reason} Sigue adelante: hay más oportunidades por delante.`
        : `Esta vez no: tu postulación para ${ctx.position} no avanzó. Suele ser una cuestión de encaje, no de capacidad. Sigue postulándote.`
    default:
      return `Tu postulación para ${ctx.position} está enviada y en espera de revisión.`
  }
}

export function clubFallbackMessageEs(ctx: FeedbackCtx): string {
  const why: Record<string, string> = {
    position_filled: 'ya cubrimos el lugar',
    different_position: 'priorizamos otra posición para este plantel',
    different_level: 'buscamos otro nivel de juego para este plantel',
    timing: 'los tiempos y la disponibilidad no coincidieron esta temporada',
    location: 'la ubicación o la mudanza no resultaron compatibles con esta oportunidad',
    eligibility: 'había un requisito de pasaporte o elegibilidad para esta oportunidad',
    profile_incomplete: 'necesitábamos más detalle en tu perfil para avanzar',
    video_missing: 'necesitábamos videos de partidos para avanzar',
  }
  const reason = ctx.reason ? why[ctx.reason] : null
  const next = ctx.reason === 'video_missing' || ctx.reason === 'different_level'
    ? ' Mantén al día tus videos de partidos completos para oportunidades similares.'
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
