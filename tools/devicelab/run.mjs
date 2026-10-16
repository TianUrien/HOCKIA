#!/usr/bin/env node
/**
 * node run.mjs [--device all|ios|android|web|<id,id>] [--scenario all|<name,name>] [--writes]
 * Runs the core journeys on each device, keeps screenshots and writes
 * report/<timestamp>/REPORT.md + results.json. Exit code 1 if anything failed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { LAB_DIR, loadDevices, IOS_APP, ANDROID_APK } from './lib/config.mjs'
import { startAppium, openSession } from './lib/appium.mjs'
import { openWeb } from './lib/web.mjs'
import { scenarios, CORE_ORDER } from './scenarios/index.mjs'

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def }
const devices = loadDevices(arg('device', 'all'))
const wanted = arg('scenario', 'all')
const names = wanted === 'all' ? CORE_ORDER : wanted.split(',')
const writes = arg('writes', false) === true
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.join(LAB_DIR, 'report', stamp)
fs.mkdirSync(outDir, { recursive: true })

for (const d of devices) {
  if (d.platform === 'ios' && !fs.existsSync(IOS_APP)) throw new Error(`iOS app missing (${IOS_APP}); run: npm run build`)
  if (d.platform === 'android' && !fs.existsSync(ANDROID_APK)) throw new Error(`Android APK missing (${ANDROID_APK}); run: npm run build`)
}

const results = []
let appium = null
if (devices.some((d) => d.platform !== 'web')) appium = await startAppium(path.join(outDir, 'appium.log'))

for (const device of devices) {
  const devDir = path.join(outDir, device.id); fs.mkdirSync(devDir, { recursive: true })
  const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${device.id}: ${m}`; console.log(line); fs.appendFileSync(path.join(outDir, 'run.log'), line + '\n') }
  let lab = null
  try {
    log('opening session…')
    lab = device.platform === 'web' ? await openWeb(device) : await openSession(device)
    log('session ready')
  } catch (err) {
    log(`SESSION FAILED: ${err.message.slice(0, 300)}`)
    results.push({ device: device.id, scenario: '(session)', status: 'error', error: err.message.slice(0, 500) })
    continue
  }
  for (const name of names) {
    const fn = scenarios[name]; if (!fn) throw new Error(`unknown scenario ${name}`)
    const notes = []
    const ctx = { writes, note: (n) => notes.push(n), shot: async (label) => { try { await lab.shot(path.join(devDir, `${name}--${label}.png`)) } catch (e) { notes.push(`screenshot failed: ${e.message.slice(0, 80)}`) } } }
    const t0 = Date.now()
    try {
      await fn(lab, ctx)
      results.push({ device: device.id, scenario: name, status: 'pass', ms: Date.now() - t0, notes })
      log(`PASS ${name} (${Math.round((Date.now() - t0) / 1000)} s)${notes.length ? ' — ' + notes.join('; ') : ''}`)
    } catch (err) {
      await ctx.shot('FAILED')
      results.push({ device: device.id, scenario: name, status: 'fail', ms: Date.now() - t0, error: err.message.slice(0, 500), notes })
      log(`FAIL ${name}: ${err.message.slice(0, 300)}`)
    }
  }
  await lab.close()
}
if (appium) appium.kill()

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ stamp, writes, results }, null, 2))
const rows = results.map((r) => `| ${r.device} | ${r.scenario} | ${r.status === 'pass' ? '✅ pass' : r.status === 'fail' ? '❌ fail' : '⚠️ error'} | ${r.ms ? Math.round(r.ms / 1000) + ' s' : ''} | ${(r.error || (r.notes || []).join('; ') || '').replace(/\|/g, '/').slice(0, 160)} |`)
fs.writeFileSync(path.join(outDir, 'REPORT.md'), `# Device lab run ${stamp}\n\nWrites: ${writes ? 'yes' : 'no'} · Devices: ${devices.map((d) => d.id).join(', ')} · Scenarios: ${names.join(', ')}\n\n| Device | Scenario | Result | Time | Notes |\n|---|---|---|---|---|\n${rows.join('\n')}\n\nScreenshots: one folder per device next to this file. Measured: DOM state and scroll positions after real swipes. Not measured: smoothness, audio, haptics — those still need a human on a device.\n`)
console.log(`\nReport: ${path.join(outDir, 'REPORT.md')}`)
process.exit(results.some((r) => r.status !== 'pass') ? 1 : 0)
