// Spanish copy for notify-age-gate (Spanish quality pass, 2026-11-16).
// The English copy stays in notify-age-gate/index.ts, unchanged; this mirrors
// it sentence for sentence (client/src/locales/glossary.md: tú to the member,
// no generic masculine, never promise outcomes, dates as "14 de noviembre").
// Kept in _shared so the deno suite covers it.

export type AgeGateKind = 'goodbye' | 'welcome_back' | 'dob_request' | 'dob_reminder'

export interface AgeGateEsInput {
  kind: AgeGateKind
  /** First name, or '' when the profile has none (greeting becomes "Hola:"). */
  firstName: string
  baseUrl: string
  /** goodbye only. */
  waitlistUrl?: string
  /** dob_request / dob_reminder only. */
  deadline?: Date
  /** welcome_back only: the shared suggestion blocks, already in Spanish. */
  suggestionsHtml?: string
  suggestionsText?: string
  /** The function's button renderer (same look as English). */
  button: (url: string, label: string) => string
  escapeHtml: (s: string) => string
}

export interface AgeGateEsEmail {
  subject: string
  /** Inner HTML (the caller wraps it in its shell). */
  inner: string
  text: string
}

/** "14 de noviembre" (day and month in words). */
export function spanishDayMonth(d: Date): string {
  return d.toLocaleDateString('es', { month: 'long', day: 'numeric' })
}

const P = 'font-size:15px;color:#3f3c4d;line-height:1.6;'
const H = 'font-size:20px;font-weight:700;color:#0e0b1a;'

export function ageGateEmailEs(input: AgeGateEsInput): AgeGateEsEmail {
  const { kind, firstName, baseUrl, button, escapeHtml } = input
  const greeting = firstName ? `Hola, ${firstName}:` : 'Hola:'
  const greetingHtml = firstName ? `Hola, ${escapeHtml(firstName)}:` : 'Hola:'

  if (kind === 'goodbye') {
    const waitlistUrl = input.waitlistUrl ?? `${baseUrl}/juniors-waitlist`
    return {
      subject: 'Tu perfil de Hockia queda guardado',
      inner: `
        <div style="${H}">${greetingHtml}</div>
        <p style="${P}">
          Por ahora, Hockia es solo para mayores de 18 años. Tu perfil está <strong>guardado, no eliminado</strong>.
          Todo lo que construiste te sigue esperando.
        </p>
        <p style="${P}">
          Estamos creando <strong>Hockia Juniors</strong>, una versión con protecciones
          pensadas para deportistas jóvenes. ¿Quieres enterarte primero cuando abra?
        </p>
        ${button(waitlistUrl, 'Avisarme')}
        <p style="font-size:13px;color:#6b6878;line-height:1.5;margin-top:20px;">
          ¿Tienes preguntas o prefieres que eliminemos tus datos? Responde a este email o escribe a
          <a href="mailto:team@inhockia.com" style="color:#6c2bd9;">team@inhockia.com</a>.
          Respondemos todos los mensajes.
        </p>`,
      text: [
        greeting, '',
        'Por ahora, Hockia es solo para mayores de 18 años. Tu perfil está guardado, no eliminado. Todo lo que construiste te sigue esperando.',
        'Estamos creando Hockia Juniors, una versión con protecciones pensadas para deportistas jóvenes. ¿Quieres enterarte primero cuando abra?',
        waitlistUrl, '',
        '¿Tienes preguntas o prefieres que eliminemos tus datos? Responde a este email o escribe a team@inhockia.com. Respondemos todos los mensajes.',
      ].join('\n'),
    }
  }

  if (kind === 'welcome_back') {
    const heading = firstName ? `¡Feliz cumpleaños número 18, ${firstName}!` : '¡Feliz cumpleaños número 18!'
    const headingHtml = firstName ? `¡Feliz cumpleaños número 18, ${escapeHtml(firstName)}!` : '¡Feliz cumpleaños número 18!'
    return {
      subject: 'Te damos la bienvenida de nuevo: tu perfil de Hockia vuelve a estar activo',
      inner: `
        <div style="${H}">${headingHtml} 🎉</div>
        <p style="${P}">
          Tu perfil de Hockia vuelve a estar activo, tal como lo dejaste. El hockey
          siguió en movimiento mientras no estabas.
        </p>
        ${input.suggestionsHtml ?? ''}
        ${button(`${baseUrl}/opportunities`, 'Ver oportunidades abiertas')}`,
      text: [
        heading, '',
        'Tu perfil de Hockia vuelve a estar activo, tal como lo dejaste. El hockey siguió en movimiento mientras no estabas.',
        input.suggestionsText ?? '', '',
        `Ver oportunidades abiertas: ${baseUrl}/opportunities`,
      ].join('\n'),
    }
  }

  // dob_request / dob_reminder
  const isReminder = kind === 'dob_reminder'
  const d = spanishDayMonth(input.deadline ?? new Date())
  const dHtml = escapeHtml(d)
  const privacy = 'Tu fecha de nacimiento sigue siendo privada: en Hockia solo se muestra tu edad.'
  return {
    subject: isReminder
      ? 'Te quedan pocos días para confirmar tu fecha de nacimiento'
      : 'Confirma tu fecha de nacimiento para mantener activo tu perfil completo',
    inner: `
        <div style="${H}">${greetingHtml}</div>
        <p style="${P}">
          ${isReminder
            ? `Un recordatorio rápido: tienes hasta el <strong>${dHtml}</strong> para confirmar tu fecha de nacimiento en Hockia.`
            : 'Hockia es una plataforma para mayores de 18 años y tu perfil todavía no tiene fecha de nacimiento. Confirmarla lleva un solo toque después de iniciar sesión.'}
        </p>
        <p style="font-size:14px;color:#3f3c4d;line-height:1.6;">
          ${isReminder
            ? 'Después de esa fecha, tu perfil queda oculto temporalmente de las búsquedas y de los mensajes nuevos hasta que confirmes. No se elimina nada.'
            : `Tienes hasta el <strong>${dHtml}</strong>. Después, tu perfil queda oculto temporalmente de las búsquedas y de los mensajes nuevos hasta que confirmes. No se elimina nada.`}
          ${privacy}
        </p>
        ${button(baseUrl, 'Confirmar ahora')}`,
    text: [
      greeting, '',
      isReminder
        ? `Un recordatorio rápido: tienes hasta el ${d} para confirmar tu fecha de nacimiento en Hockia.`
        : 'Hockia es una plataforma para mayores de 18 años y tu perfil todavía no tiene fecha de nacimiento. Confirmarla lleva un solo toque después de iniciar sesión.',
      `Después del ${d}, tu perfil queda oculto temporalmente de las búsquedas y de los mensajes nuevos hasta que confirmes. No se elimina nada. ${privacy}`,
      '', `Confirmar ahora: ${baseUrl}`,
    ].join('\n'),
  }
}
