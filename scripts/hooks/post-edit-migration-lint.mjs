#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook (matcher: Write|Edit). See docs/engineering/hooks.md.
 *
 * Reads the tool call as JSON on stdin. When the edited file is a migration
 * (`supabase/migrations/<version>_<name>.sql`), runs
 * `node scripts/check-migrations.mjs <file>` and reports its findings back
 * to the agent. Any other path exits immediately.
 *
 * Exit codes (Claude Code semantics for PostToolUse):
 *   0  nothing to report
 *   2  problems found; stderr is shown to the agent so it can fix the
 *      migration (missing GRANT/REVOKE on a new object, missing rollback file)
 *
 * The lint is static and never connects to a database. A "no rollback file"
 * finding right after creating a migration simply means the rollback has
 * not been written yet.
 */
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LINT = resolve(ROOT, 'scripts', 'check-migrations.mjs')

let raw = ''
for await (const chunk of process.stdin) raw += chunk

let file = ''
try {
  const call = JSON.parse(raw)
  file = String(call?.tool_input?.file_path ?? '')
} catch {
  file = ''
}
if (!file) process.exit(0)

const abs = resolve(ROOT, file)
const rel = relative(ROOT, abs).split(sep).join('/')
if (!/^supabase\/migrations\/[^/]+\.sql$/.test(rel)) process.exit(0)

const result = spawnSync(process.execPath, [LINT, abs], { cwd: ROOT, encoding: 'utf8' })
if (result.status === 0) process.exit(0)

const report = (result.stderr || result.stdout || result.error?.message || '').trim()
process.stderr.write(`migration lint hook: problems in ${rel}\n${report}\n`)
process.exit(2)
