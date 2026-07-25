#!/usr/bin/env node
/**
 * Dependency audit gate with a documented allowlist.
 *
 * Replaces a bare `npm audit --audit-level=high` so we can keep the bar HIGH
 * while carrying explicit, justified exceptions for advisories that are
 * unreachable in our architecture (see audit-allowlist.json).
 *
 * Fails when:
 *   - any high/critical advisory is reported that is NOT allowlisted
 *   - an allowlist entry is past its review_by date (forces re-evaluation)
 *   - an allowlist entry no longer matches anything (stale — delete it)
 *
 * Exit 0 = clean or only-allowlisted findings.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FAIL_LEVELS = new Set(['high', 'critical'])

function runAudit() {
  try {
    // Exits non-zero when vulnerabilities exist — capture stdout either way.
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (err) {
    if (err.stdout) return err.stdout
    throw err
  }
}

function loadAllowlist() {
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'audit-allowlist.json'), 'utf8'))
    return Array.isArray(raw.allow) ? raw.allow : []
  } catch {
    return []
  }
}

/** Collect every advisory id/url reported at a failing severity. */
function collectFindings(report) {
  const findings = []
  for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {})) {
    if (!FAIL_LEVELS.has(v.severity)) continue
    for (const via of v.via ?? []) {
      if (typeof via !== 'object') continue
      const id = (via.url ?? '').split('/').pop() || via.source
      findings.push({
        pkg,
        id: String(id),
        title: via.title ?? '(no title)',
        severity: via.severity ?? v.severity,
        url: via.url ?? '',
      })
    }
  }
  return findings
}

const report = JSON.parse(runAudit())
const allow = loadAllowlist()
const allowById = new Map(allow.map((a) => [a.id, a]))
const findings = collectFindings(report)

const today = new Date().toISOString().slice(0, 10)
const blocking = []
const waived = []

for (const f of findings) {
  const entry = allowById.get(f.id)
  if (!entry) {
    blocking.push(f)
    continue
  }
  if (entry.review_by && entry.review_by < today) {
    blocking.push({ ...f, title: `${f.title} — ALLOWLIST EXPIRED (review_by ${entry.review_by})` })
    continue
  }
  waived.push({ ...f, review_by: entry.review_by })
}

// Stale entries: allowlisted but no longer reported → should be removed.
const reportedIds = new Set(findings.map((f) => f.id))
const stale = allow.filter((a) => !reportedIds.has(a.id))

if (waived.length) {
  console.log('Waived (documented in audit-allowlist.json):')
  for (const w of waived) console.log(`  · ${w.severity} ${w.pkg} ${w.id} — review by ${w.review_by}`)
}
if (stale.length) {
  console.log('\nStale allowlist entries (no longer reported — delete them):')
  for (const s of stale) console.log(`  · ${s.id} (${s.package})`)
}
if (blocking.length) {
  console.error('\nBlocking vulnerabilities:')
  for (const b of blocking) console.error(`  ✖ ${b.severity} ${b.pkg} ${b.id} — ${b.title}\n    ${b.url}`)
  console.error(`\n${blocking.length} blocking advisory(ies). Fix, or add a justified entry to audit-allowlist.json.`)
  process.exit(1)
}

// Stale entries are a warning, not a failure — they don't weaken the gate.
console.log(`\nAudit gate passed (${waived.length} waived, 0 blocking).`)
