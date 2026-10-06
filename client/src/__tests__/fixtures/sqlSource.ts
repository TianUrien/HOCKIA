/**
 * Reads SQL function bodies straight from supabase/migrations, for tests that
 * pin a client mirror to the server rule it copies (no database needed).
 *
 * A function is redefined by later migrations, so the body returned is always
 * the NEWEST definition: the last `CREATE [OR REPLACE] FUNCTION public.<name>(`
 * in filename order. Rollback files and probes are not read.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')

let cache: { file: string; sql: string }[] | null = null

function migrations(): { file: string; sql: string }[] {
  if (!cache) {
    cache = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((file) => ({ file, sql: readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8') }))
  }
  return cache
}

export interface SqlFunction {
  name: string
  /** Migration file holding the newest definition. */
  file: string
  body: string
}

export function newestFunction(name: string): SqlFunction {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?"?${name}"?\\s*\\(`, 'gi')
  let found: SqlFunction | null = null
  for (const { file, sql } of migrations()) {
    head.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = head.exec(sql))) {
      const rest = sql.slice(m.index)
      const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(rest)
      if (!tag) continue
      const start = rest.indexOf(tag[1]) + tag[1].length
      const end = rest.indexOf(tag[1], start)
      if (end < 0) continue
      found = { name, file, body: rest.slice(start, end) }
    }
  }
  if (!found) throw new Error(`No definition of public.${name} in supabase/migrations`)
  return found
}

export interface SqlRaise {
  message: string
  detail: string | null
  errcode: string | null
}

/** Every `RAISE EXCEPTION '<text>' [USING …]` in a function body, in order. */
export function raisesOf(fn: SqlFunction): SqlRaise[] {
  const out: SqlRaise[] = []
  const re = /RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'([^;]*);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fn.body))) {
    out.push({
      message: m[1].replace(/''/g, "'"),
      detail: /DETAIL\s*=\s*'([^']*)'/.exec(m[2])?.[1] ?? null,
      errcode: /ERRCODE\s*=\s*'([^']*)'/.exec(m[2])?.[1] ?? null,
    })
  }
  return out
}

/**
 * The application statuses a function lets through, read from the guard that
 * precedes the given refusal:
 *   IF v_app.status::text NOT IN ('a', 'b') THEN RAISE EXCEPTION '<refusal>'
 *   IF v_app.status::text <> 'a' THEN RAISE EXCEPTION '<refusal>'
 * (the guard may span lines and carry other OR-ed conditions).
 */
export function statusesAllowedBefore(fn: SqlFunction, refusal: string): string[] {
  const at = fn.body.indexOf(`RAISE EXCEPTION '${refusal.replace(/'/g, "''")}`)
  if (at < 0) throw new Error(`${fn.name}: refusal not found: ${refusal}`)
  const ifAt = fn.body.lastIndexOf('IF ', at)
  const guard = fn.body.slice(ifAt, at)
  const notIn = /v_app\.status::text\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(guard)
  if (notIn) return [...notIn[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  const notEqual = /v_app\.status::text\s*<>\s*'([a-z_]+)'/i.exec(guard)
  if (notEqual) return [notEqual[1]]
  throw new Error(`${fn.name}: no application-status guard before: ${refusal}`)
}
