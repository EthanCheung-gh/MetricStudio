import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const children = [
  spawn(process.execPath, [path.join(root, 'scripts', 'start-backend.js'), '--reload'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '0.0.0.0'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  }),
]

const shutdown = (signal) => {
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

for (const child of children) {
  child.once('error', (error) => console.error(`MetricStudio dev process failed: ${error.message}`))
}

children[1].once('exit', (code, signal) => {
  shutdown('SIGTERM')
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
