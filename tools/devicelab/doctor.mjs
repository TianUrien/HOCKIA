#!/usr/bin/env node
/** Checks everything a run needs and says what is missing. */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANDROID_SDK, ANDROID_APK, IOS_APP, JAVA_HOME, WDA_RUNNER, loadDevices } from './lib/config.mjs'
import { simulatorUdid, avdExists } from './lib/sim.mjs'

const ok = (m) => console.log('✅', m), bad = (m) => { console.log('❌', m); process.exitCode = 1 }
try { ok(`node ${process.version}`) } catch { bad('node') }
try { execFileSync('xcodebuild', ['-version']); ok('Xcode') } catch { bad('Xcode (xcodebuild)') }
try { execFileSync(path.join(JAVA_HOME, 'bin', 'java'), ['-version'], { stdio: 'ignore' }); ok(`Java at ${JAVA_HOME}`) } catch { bad(`Java missing at ${JAVA_HOME}`) }
fs.existsSync(path.join(ANDROID_SDK, 'emulator', 'emulator')) ? ok(`Android SDK at ${ANDROID_SDK}`) : bad(`Android SDK missing at ${ANDROID_SDK}`)
try { const out = execFileSync('npx', ['appium', 'driver', 'list', '--installed'], { cwd: path.dirname(new URL(import.meta.url).pathname) }).toString() + ''; ok('Appium drivers: ' + out.split('\n').filter((l) => l.includes('installed')).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).join(' · ')) } catch (e) { bad('Appium drivers: ' + e.stderr?.toString().slice(0, 100)) }
for (const d of loadDevices('all')) {
  if (d.platform === 'ios') { try { ok(`${d.id}: simulator "${d.simulator}" (${simulatorUdid(d.simulator, d.runtime)})`) } catch (e) { bad(`${d.id}: ${e.message}`) } }
  else if (d.platform === 'android') { avdExists(d.avd) ? ok(`${d.id}: AVD ${d.avd}`) : bad(`${d.id}: AVD ${d.avd} missing`) }
  else ok(`${d.id}: Playwright ${d.browser}`)
}
fs.existsSync(IOS_APP) ? ok('iOS simulator app built') : bad('iOS simulator app not built → npm run build')
fs.existsSync(ANDROID_APK) ? ok('Android debug APK built') : bad('Android APK not built → npm run build')
fs.existsSync(WDA_RUNNER) ? ok('WebDriverAgent prebuilt') : bad('WebDriverAgent not built → npm run build')
fs.existsSync(path.join(os.homedir(), '.config', 'hockia', 'staging-qa.env')) ? ok('QA credentials file present') : bad('~/.config/hockia/staging-qa.env missing (QA_EMAIL / QA_PASSWORD)')
