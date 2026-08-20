import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const binaryDir = fileURLToPath(new URL('../src-tauri/binaries/', import.meta.url))
const files = readdirSync(binaryDir).filter((name) => name.startsWith('python-sidecar-'))
if (files.length === 0) {
  console.error('error: no built sidecar found under src-tauri/binaries')
  process.exit(1)
}
const command = process.platform === 'win32' ? 'python' : 'python3'
const result = spawnSync(command, ['scripts/smoke-sidecar.py', join(binaryDir, files[0]), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
