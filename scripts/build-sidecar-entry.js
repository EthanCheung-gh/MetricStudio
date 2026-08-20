import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']
for (const command of candidates) {
  const result = spawnSync(command, ['scripts/build-sidecar.py', ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: root,
  })
  if (result.error?.code === 'ENOENT') continue
  process.exit(result.status ?? 1)
}
console.error(`error: Python not found; tried ${candidates.join(', ')}`)
process.exit(1)
