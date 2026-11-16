#!/usr/bin/env node
/**
 * Catalog parity check (docs/engineering/spanish-localization-plan.md, 5.5).
 *
 * Fails when a language other than English:
 *   - lacks a namespace file or a key that English has (plural keys are
 *     compared by their base name, so `item_one`/`item_other` in English is
 *     satisfied by whatever plural forms the other language needs),
 *   - lacks a plural form its own grammar needs,
 *   - has a key English does not have,
 *   - has an empty value,
 *   - a start-up file uses a key that is not in its namespace's core file, or
 *   - uses different {{variables}} or <tags> than English.
 *
 * Usage: node scripts/check-locales.mjs [localesDir]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, full, out)
    else out.set(full, value)
  }
  return out
}

const placeholders = (text) => [...String(text).matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}|<\/?([a-zA-Z0-9]+)[^>]*>/g)]
  .map((m) => m[1] ?? `<${m[2]}>`).sort().join('|')

const baseOf = (key) => key.replace(PLURAL_SUFFIX, '')

/** The plural forms a language needs for whole numbers, from the runtime's own CLDR data. */
function pluralForms(language) {
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories
}

export function checkLocales(localesDir) {
  const problems = []
  const sourceDir = path.join(localesDir, 'en')
  // en/<ns>.core.json is the start-up part of en/<ns>.json: one namespace, two files.
  const namespaces = readdirSync(sourceDir).filter((f) => f.endsWith('.json') && !f.endsWith('.core.json'))
  const languages = readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'en').map((d) => d.name)

  for (const language of languages) {
    for (const file of readdirSync(path.join(localesDir, language)).filter((f) => f.endsWith('.json'))) {
      if (!namespaces.includes(file)) problems.push(`${language}/${file}: no English catalog with this name`)
    }
    for (const file of namespaces) {
      const where = `${language}/${file}`
      const targetPath = path.join(localesDir, language, file)
      if (!existsSync(targetPath)) { problems.push(`${where}: file is missing`); continue }
      const source = flatten(JSON.parse(readFileSync(path.join(sourceDir, file), 'utf8')), '', new Map())
      const corePath = path.join(sourceDir, file.replace(/\.json$/, '.core.json'))
      if (existsSync(corePath)) {
        for (const [key, value] of flatten(JSON.parse(readFileSync(corePath, 'utf8')), '', new Map())) {
          if (source.has(key)) problems.push(`en/${file}: "${key}" is in both the core file and the main file`)
          source.set(key, value)
        }
      }
      const target = flatten(JSON.parse(readFileSync(targetPath, 'utf8')), '', new Map())
      const sourceBases = new Map()
      for (const [key, value] of source) {
        if (!sourceBases.has(baseOf(key))) sourceBases.set(baseOf(key), { value, plural: PLURAL_SUFFIX.test(key) })
      }
      const targetBases = new Set([...target.keys()].map(baseOf))

      for (const [base, info] of sourceBases) {
        if (!targetBases.has(base)) { problems.push(`${where}: missing "${base}"`); continue }
        if (!info.plural) continue
        for (const form of pluralForms(language)) {
          if (!target.has(`${base}_${form}`)) problems.push(`${where}: "${base}" needs the plural form "_${form}"`)
        }
      }
      for (const [key, value] of target) {
        const base = baseOf(key)
        if (!sourceBases.has(base)) { problems.push(`${where}: "${key}" does not exist in English`); continue }
        if (typeof value !== 'string' || !value.trim()) { problems.push(`${where}: "${key}" is empty`); continue }
        const english = source.get(key) ?? source.get(`${base}_other`) ?? sourceBases.get(base).value
        if (placeholders(english) !== placeholders(value)) {
          problems.push(`${where}: "${key}" uses different variables or tags than English (${placeholders(english) || 'none'} vs ${placeholders(value) || 'none'})`)
        }
      }
    }
  }
  return problems
}

/**
 * Start-up files import a namespace's core part only ('@/i18n/ns/<ns>.core').
 * A key they use must be in en/<ns>.core.json, or English would be missing
 * until the rest of the catalog loads with a lazy screen.
 */
export function checkCoreUsage(localesDir, srcDir) {
  const problems = []
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return ['__tests__', 'i18n', 'locales'].includes(e.name) ? [] : walk(full)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
  })
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8')
    const match = /from '@\/i18n\/ns\/(\w+)\.core'/.exec(text)
    if (!match) continue
    const restPath = path.join(localesDir, 'en', `${match[1]}.json`)
    if (!existsSync(restPath)) continue
    const rest = [...flatten(JSON.parse(readFileSync(restPath, 'utf8')), '', new Map()).keys()]
    for (const [, literal] of text.matchAll(/['"`]([A-Za-z][\w.]*)(?=['"`]|\$\{)/g)) {
      const base = literal.replace(/\.$/, '')
      const hit = rest.find((key) => key === base || baseOf(key) === base
        || ((literal.includes('.')) && key.startsWith(`${base}.`)))
      if (hit) problems.push(`${path.relative(srcDir, file)}: uses "${literal}" (${match[1]}), which is not in en/${match[1]}.core.json`)
    }
  }
  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
  const problems = [...checkLocales(dir), ...checkCoreUsage(dir, path.join(dir, '..'))]
  if (problems.length) {
    console.error(`Locale check failed (${problems.length}):`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('Locale check passed: every English key has a translation with matching variables.')
}
