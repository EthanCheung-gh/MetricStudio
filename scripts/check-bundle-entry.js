import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundleDir = fileURLToPath(new URL('../src-tauri/target/release/bundle/', import.meta.url))
const files = readdirSync(bundleDir, { withFileTypes: true }).flatMap((entry) => {
  if (!entry.isDirectory()) return []
  return readdirSync(join(bundleDir, entry.name)).filter((name) => name.endsWith('.deb') || name.endsWith('.rpm')).map((name) => join(bundleDir, entry.name, name))
})
if (files.length === 0) {
  console.error('error: no deb/rpm bundle found')
  process.exit(1)
}
const command = process.platform === 'win32' ? 'python' : 'python3'
const result = spawnSync(command, ['scripts/check-bundle.py', files[0], ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
