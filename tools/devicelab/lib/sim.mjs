import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANDROID_SDK } from './config.mjs'

const ADB = path.join(ANDROID_SDK, 'platform-tools', 'adb')

/** UDID of an available simulator by name + runtime ("iOS 27.0"). */
export function simulatorUdid(name, runtime) {
  const json = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).toString())
  const key = Object.keys(json.devices).find((k) => k.replace('com.apple.CoreSimulator.SimRuntime.', '').replace(/-/g, ' ') === runtime.replace('.', ' ') || k.endsWith(runtime.replace('iOS ', 'iOS-').replace('.', '-')))
  const list = key ? json.devices[key] : Object.values(json.devices).flat()
  const dev = list.find((d) => d.name === name && d.isAvailable)
  if (!dev) throw new Error(`Simulator "${name}" on ${runtime} not found. Available: ${list.map((d) => d.name).join(', ')}`)
  return dev.udid
}

export function bootSimulator(udid) {
  try { execFileSync('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' }) } catch { /* already booted */ }
  execFileSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' })
}

export function shutdownSimulator(udid) {
  try { execFileSync('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' }) } catch { /* not booted */ }
}

export function avdExists(name) {
  const out = execFileSync(`${ANDROID_SDK}/emulator/emulator`, ['-list-avds']).toString()
  return out.split('\n').map((s) => s.trim()).includes(name)
}

/** Serials of running emulators (adb). */
export function runningEmulators() {
  try { return execFileSync(ADB, ['devices']).toString().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[0]?.startsWith('emulator-') && p[1] === 'device').map((p) => p[0]) } catch { return [] }
}

/** Stop every running emulator so the next AVD boots alone (two at once = slow boots and lock clashes). */
export function killEmulators() {
  for (const serial of runningEmulators()) { try { execFileSync(ADB, ['-s', serial, 'emu', 'kill'], { stdio: 'ignore' }) } catch { /* already gone */ } }
}

/**
 * A crashed or killed emulator leaves *.lock files in the AVD folder and the
 * next boot refuses with "Running multiple emulators with the same AVD".
 * Safe to delete when no emulator is running.
 */
export function cleanAvdLocks(name) {
  if (runningEmulators().length) return
  const ini = path.join(os.homedir(), '.android', 'avd', `${name}.ini`)
  if (!fs.existsSync(ini)) return
  const dir = (fs.readFileSync(ini, 'utf8').match(/^path=(.*)$/m) || [])[1]
  if (!dir || !fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.lock')) fs.rmSync(path.join(dir, f), { force: true })
}
