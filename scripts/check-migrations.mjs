#!/usr/bin/env node
/**
 * Migration lint (CI job "Migration Validation", also runnable locally):
 *
 *   node scripts/check-migrations.mjs            # lint every migration newer than MIN_VERSION
 *   node scripts/check-migrations.mjs --all      # include every migration (informational)
 *   node scripts/check-migrations.mjs <file...>  # lint only the given migration files
 *
 * Three rules, from docs/engineering/standards.md section 6:
 *
 *   1. GRANTS   Every table, view or function a migration CREATES must have an
 *               explicit GRANT or REVOKE statement for it in the same file.
 *               From 2026-10-30 Supabase stops providing default ACLs for new
 *               objects, so an object without grants is unreachable (or, for a
 *               function, callable by PUBLIC). `CREATE OR REPLACE` of an object
 *               that an EARLIER migration already created keeps its ACL and is
 *               not flagged; only the first appearance of a name counts.
 *
 *   2. ROLLBACK Every migration must have supabase/rollbacks/<version>_*.down.sql.
 *               A combined rollback file may cover several versions by listing
 *               each version number in its text (see 20260928200000_d2_slice1).
 *
 *   3. ANON     (migrations from ANON_RULE_FROM on) A SECURITY DEFINER function
 *               that a migration revokes from PUBLIC must also carry an explicit
 *               decision for anon in the same file: a REVOKE ... FROM anon or a
 *               GRANT ... TO anon naming it. Until 2026-10-30 this platform grants
 *               EXECUTE on new functions to anon by default ACL, so revoking from
 *               PUBLIC alone leaves the function callable signed out. Whether a
 *               function is SECURITY DEFINER is read from its newest CREATE up to
 *               and including that migration.
 *
 * The lint is static and conservative: it reads SQL as text, strips comments
 * and string literals, and only reports what it can prove. It never connects
 * to a database.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const ROLLBACKS_DIR = join(ROOT, 'supabase', 'rollbacks')

/** Rule 3 (anon decision) applies to migrations at or after this version. Older files
 *  are history: several revoke from PUBLIC only and are covered by later revokes. */
const ANON_RULE_FROM = 20261006100000n

/** Migrations at or below this version predate the rollback-file convention. */
const MIN_VERSION = 20260926100000n

/**
 * Migrations newer than MIN_VERSION that shipped before this lint existed and
 * have no rollback file. Frozen list: do not add to it; write the rollback.
 */
const ROLLBACK_BASELINE_EXEMPT = new Set([
  '20260926110000', // search_appearances_select_self
  '20260926120000', // full_match_privacy
  '20260926130000', // club_v2_fixes
  '20260926140000', // vacancy_announce_first_publish_only
  '20260926150000', // fit_cache_owner_and_expiry_grants
  '20260928100000', // recruiting_status_enums
  '20260928120000', // recruiting_server_functions
  '20260928130000', // club_fit_recruiters_only
])

// ── SQL text helpers ──────────────────────────────────────────────────────

/** Remove line and block comments, and blank out the body of $$ / $tag$ strings
 *  and single-quoted literals so DDL inside function bodies is not matched. */
function stripSql(sql) {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += sql.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? n : end + tag.length
        out += ' ' + sql.slice(i, stop).replace(/[^\n]/g, ' ').slice(1)
        i = stop
        continue
      }
    }
    if (ch === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") break
        j++
      }
      out += "'" + sql.slice(i + 1, j).replace(/[^\n]/g, ' ') + "'"
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

/** `public.foo`, `"public"."foo"`, `foo` -> `foo` (lower-cased, unquoted). */
function bareName(ident) {
  const parts = ident.split('.')
  return parts[parts.length - 1].replace(/"/g, '').toLowerCase()
}

const IDENT = String.raw`("?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?`

const CREATE_RE = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unlogged)\s+)?(table|view|materialized\s+view|function|procedure)\s+(?:if\s+not\s+exists\s+)?(${IDENT})`,
  'gi',
)

/** Objects created in a (stripped) migration: [{ kind, name }]. Temp tables are skipped. */
function createdObjects(stripped) {
  const found = []
  for (const m of stripped.matchAll(CREATE_RE)) {
    const isTemp = /\b(temp|temporary)\s+table\b/i.test(m[0])
    if (isTemp) continue
    const kind = m[1].toLowerCase().replace(/\s+/g, ' ')
    found.push({ kind: kind === 'materialized view' ? 'view' : kind, name: bareName(m[2]) })
  }
  return found
}

/** SECURITY DEFINER flag per function name for the CREATE statements of a (stripped)
 *  migration. Function bodies are blanked by stripSql, so the text from CREATE to
 *  the next `;` is the header plus attributes. */
function definerFlags(stripped) {
  const flags = new Map()
  for (const m of stripped.matchAll(CREATE_RE)) {
    const kind = m[1].toLowerCase()
    if (kind !== 'function' && kind !== 'procedure') continue
    const end = stripped.indexOf(';', m.index)
    const header = stripped.slice(m.index, end === -1 ? undefined : end)
    flags.set(bareName(m[2]), /\bsecurity\s+definer\b/i.test(header))
  }
  return flags
}

const FN_ACL_RE = new RegExp(
  String.raw`^\s*(grant|revoke)\b[\s\S]*?\bon\s+(?:function|procedure)\s+(${IDENT})[\s\S]*?\b(to|from)\s+([\s\S]*)$`,
  'i',
)

/** GRANT/REVOKE ... ON FUNCTION statements: [{ verb, name, roles }] (roles lower-cased). */
function functionAclStatements(stripped) {
  const out = []
  for (const statement of stripped.split(';')) {
    const m = FN_ACL_RE.exec(statement)
    if (!m) continue
    const roles = m[5]
      .replace(/\b(cascade|restrict|with\s+grant\s+option|granted\s+by\s+\S+)\b/gi, ' ')
      .split(',')
      .map((r) => r.trim().replace(/"/g, '').toLowerCase())
      .filter(Boolean)
    out.push({ verb: m[1].toLowerCase(), name: bareName(m[2]), roles: new Set(roles) })
  }
  return out
}

/** True when a GRANT/REVOKE statement in the (stripped) text names the object. */
function hasGrantFor(stripped, name) {
  const statements = stripped.split(';')
  const re = new RegExp(String.raw`(^|[\s.",])"?${name}"?\b`, 'i')
  return statements.some((s) => /^\s*(grant|revoke)\b/i.test(s) && re.test(s))
}

// ── File discovery ────────────────────────────────────────────────────────

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f))
}

function versionOf(file) {
  return basename(file).match(/^(\d+)/)[1]
}

/** Rollback coverage: a `<version>_*.down.sql` file, or a combined rollback that lists the version. */
function rollbackIndex() {
  const byVersion = new Map()
  const combined = []
  if (!existsSync(ROLLBACKS_DIR)) return { byVersion, combined }
  for (const f of readdirSync(ROLLBACKS_DIR)) {
    if (!f.endsWith('.down.sql')) continue
    const v = f.match(/^(\d+)/)?.[1]
    if (v) byVersion.set(v, f)
    combined.push({ file: f, text: readFileSync(join(ROLLBACKS_DIR, f), 'utf8') })
  }
  return { byVersion, combined }
}

function rollbackFor(version, index) {
  if (index.byVersion.has(version)) return index.byVersion.get(version)
  const hit = index.combined.find((c) => c.text.includes(version))
  return hit ? `${hit.file} (combined rollback listing ${version})` : null
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(argv) {
  const all = argv.includes('--all')
  const explicit = argv.filter((a) => !a.startsWith('--'))

  /** Every migration, in order: used to know whether a name was created earlier. */
  const everyMigration = migrationFiles()
  const firstSeen = new Map() // bare object name -> version that first creates it
  const definerAt = new Map() // version -> Map(function name -> SECURITY DEFINER as of that version)
  const definerSoFar = new Map()
  for (const file of everyMigration) {
    const v = versionOf(file)
    const stripped = stripSql(readFileSync(file, 'utf8'))
    for (const { name } of createdObjects(stripped)) {
      if (!firstSeen.has(name)) firstSeen.set(name, v)
    }
    for (const [name, isDefiner] of definerFlags(stripped)) definerSoFar.set(name, isDefiner)
    definerAt.set(v, new Map(definerSoFar))
  }

  let targets
  if (explicit.length) {
    targets = explicit.map((p) => resolve(p)).filter((p) => p.startsWith(MIGRATIONS_DIR) && p.endsWith('.sql'))
  } else if (all) {
    targets = everyMigration
  } else {
    targets = everyMigration.filter((f) => BigInt(versionOf(f)) > MIN_VERSION)
  }

  const index = rollbackIndex()
  const errors = []
  let checked = 0

  for (const file of targets) {
    const rel = file.slice(ROOT.length + 1)
    const version = versionOf(file)
    const stripped = stripSql(readFileSync(file, 'utf8'))
    checked++

    // Rule 1: grants on objects this migration is the first to create.
    for (const { kind, name } of createdObjects(stripped)) {
      if (firstSeen.get(name) !== version) continue // replaced, not created: ACL is kept
      if (!hasGrantFor(stripped, name)) {
        errors.push(
          `${rel}: ${kind} "${name}" is created here without a GRANT or REVOKE naming it.\n` +
            `    Add e.g.  REVOKE ALL ON ${kind.toUpperCase()} public.${name}${kind === 'function' ? '(...)' : ''} FROM PUBLIC;  then grant what each role needs\n` +
            `    (standards.md section 6, rule 5: Supabase provides no default ACL for new objects from 2026-10-30).`,
        )
      }
    }

    // Rule 3: SECURITY DEFINER revoked from PUBLIC needs an explicit anon decision.
    if (BigInt(version) >= ANON_RULE_FROM) {
      const definer = definerAt.get(version) ?? new Map()
      const byName = new Map()
      for (const st of functionAclStatements(stripped)) {
        const entry = byName.get(st.name) ?? { revokedPublic: false, anonDecided: false }
        if (st.verb === 'revoke' && st.roles.has('public')) entry.revokedPublic = true
        if (st.roles.has('anon')) entry.anonDecided = true
        byName.set(st.name, entry)
      }
      for (const [name, { revokedPublic, anonDecided }] of byName) {
        if (revokedPublic && !anonDecided && definer.get(name) === true) {
          errors.push(
            `${rel}: SECURITY DEFINER function "${name}" is revoked from PUBLIC but this file makes no decision for anon.\n` +
              `    Until 2026-10-30 anon holds EXECUTE by default ACL. Add  REVOKE ... ON FUNCTION public.${name}(...) FROM PUBLIC, anon;\n` +
              `    or, if signed-out callers really need it,  GRANT EXECUTE ON FUNCTION public.${name}(...) TO anon;`,
          )
        }
      }
    }

    // Rule 2: a rollback file.
    if (BigInt(version) > MIN_VERSION && !ROLLBACK_BASELINE_EXEMPT.has(version)) {
      if (!rollbackFor(version, index)) {
        errors.push(
          `${rel}: no rollback file. Add supabase/rollbacks/${version}_<name>.down.sql restoring the previous\n` +
            `    function bodies, policies and grants (standards.md section 6, rule 3).`,
        )
      }
    }
  }

  if (errors.length) {
    console.error(`check-migrations: ${errors.length} problem(s) in ${checked} migration file(s)\n`)
    for (const e of errors) console.error(`  ✗ ${e}\n`)
    process.exit(1)
  }
  console.log(`check-migrations: ${checked} migration file(s) checked, no problems.`)
}

main(process.argv.slice(2))
