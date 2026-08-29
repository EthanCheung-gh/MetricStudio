import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const isTest = process.argv.includes('--test')
const port = process.env.METRICSTUDIO_BACKEND_PORT ?? '8123'
// Loopback by default; set METRICSTUDIO_BACKEND_HOST=0.0.0.0 for LAN access.
const host = process.env.METRICSTUDIO_BACKEND_HOST ?? '127.0.0.1'

if (!isTest) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    if (response.ok) {
      console.log(`MetricStudio backend is already running on 127.0.0.1:${port}`)
      process.exit(0)
    }
  } catch {
    // No existing backend; continue with startup.
  }
}

const pythonNames = process.platform === 'win32' ? ['python.exe', 'python'] : ['python', 'python3']
const candidates = [
  process.env.METRICSTUDIO_PYTHON,
  ...pythonNames.flatMap((name) => [
    path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', name),
    path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', name),
  ]),
  ...pythonNames,
].filter(Boolean)

const python = candidates.find((candidate) => {
  if (candidate.includes(path.sep)) return existsSync(candidate)
  return spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0
})
if (!python) {
  console.error('MetricStudio backend Python environment was not found.')
  console.error('Create backend/.venv and install backend/requirements.txt, or set METRICSTUDIO_PYTHON.')
  process.exit(1)
}

if (!isTest) {
  const dependencyCheck = spawnSync(python, ['-c', 'import fastapi, uvicorn, pandas, pyarrow'], { encoding: 'utf8' })
  if (dependencyCheck.status !== 0) {
    console.error(`MetricStudio backend dependencies are unavailable in ${python}.`)
    console.error('Run: cd backend && uv venv && uv pip install -r requirements.txt')
    process.exit(1)
  }
}

const args = isTest
  ? ['-m', 'pytest', 'backend/tests', '-q']
  : ['-m', 'uvicorn', 'backend.main:app', '--host', host, '--port', port]
if (process.argv.includes('--reload')) args.push('--reload')

console.log(`Starting MetricStudio backend with ${python}`)
const child = spawn(python, args, { cwd: root, env: process.env, stdio: 'inherit' })

const shutdown = (signal) => {
  if (!child.killed) child.kill(signal)
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
