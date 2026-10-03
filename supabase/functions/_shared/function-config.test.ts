/**
 * Structural guard: `supabase/config.toml` is the single source of truth for
 * each edge function's gateway `verify_jwt` setting (consolidated 2026-10-02;
 * the per-function `config.toml` files are gone).
 *
 * Two properties are pinned:
 *   1. every function folder under supabase/functions (except _shared) has a
 *      `[functions.<name>]` table with an explicit `verify_jwt` value;
 *   2. every `[functions.<name>]` table names a folder that exists (no stale
 *      entries after a function is deleted or renamed).
 *
 * Without (1) a plain `supabase functions deploy` silently resets the function
 * to the platform default, which has 401'd legitimate traffic before.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.208.0/path/mod.ts'

const here = dirname(fromFileUrl(import.meta.url))
const functionsDir = join(here, '..')
const configPath = join(functionsDir, '..', 'config.toml')

function functionFolders(): string[] {
  const names: string[] = []
  for (const entry of Deno.readDirSync(functionsDir)) {
    if (entry.isDirectory && entry.name !== '_shared') names.push(entry.name)
  }
  return names.sort()
}

/** Minimal TOML read: `[functions.<name>]` tables and their `verify_jwt` key. */
function pinnedFunctions(toml: string): Map<string, boolean | undefined> {
  const pinned = new Map<string, boolean | undefined>()
  let current: string | null = null
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    const table = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/)
    if (table) {
      current = table[1]
      if (!pinned.has(current)) pinned.set(current, undefined)
      continue
    }
    if (line.startsWith('[')) {
      current = null
      continue
    }
    const kv = current && line.match(/^verify_jwt\s*=\s*(true|false)$/)
    if (kv) pinned.set(current!, kv[1] === 'true')
  }
  return pinned
}

Deno.test('every edge function folder has a verify_jwt entry in supabase/config.toml', () => {
  const pinned = pinnedFunctions(Deno.readTextFileSync(configPath))
  const missing = functionFolders().filter((name) => pinned.get(name) === undefined)
  assertEquals(
    missing,
    [],
    `Add [functions.<name>] verify_jwt = true|false to supabase/config.toml for: ${missing.join(', ')}`,
  )
})

Deno.test('every [functions.<name>] entry in supabase/config.toml names an existing folder', () => {
  const folders = new Set(functionFolders())
  const stale = [...pinnedFunctions(Deno.readTextFileSync(configPath)).keys()].filter(
    (name) => !folders.has(name),
  )
  assertEquals(stale, [], `Remove stale entries from supabase/config.toml: ${stale.join(', ')}`)
})

Deno.test('no per-function config.toml files remain (root file is the only source)', () => {
  const strays = functionFolders().filter((name) => {
    try {
      Deno.statSync(join(functionsDir, name, 'config.toml'))
      return true
    } catch {
      return false
    }
  })
  assertEquals(strays, [], `Move verify_jwt into supabase/config.toml and delete: ${strays.join(', ')}`)
})
