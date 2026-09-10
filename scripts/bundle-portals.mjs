import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const crmRoot = process.env.CRM_ROOT
  ? path.resolve(process.env.CRM_ROOT)
  : path.resolve(desktopRoot, '..', 'new-crm-supabase')

const PORTAL = { name: 'employee-portal', dest: 'employee' }

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: true })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

if (!fs.existsSync(crmRoot)) {
  console.error(`CRM repo not found at ${crmRoot}. Set CRM_ROOT to the new-crm-supabase path.`)
  process.exit(1)
}

const dir = path.join(crmRoot, PORTAL.name)
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  throw new Error(`Missing ${dir}`)
}
if (!fs.existsSync(path.join(dir, 'node_modules'))) {
  console.log(`\nInstalling ${PORTAL.name} dependencies...`)
  await run('npm', ['install'], dir)
}
console.log(`\nBuilding ${PORTAL.name}...`)
await run('npm', ['run', 'build'], dir)
const dist = path.join(dir, 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error(`Build did not produce ${dist}/index.html`)
}
const dest = path.join(desktopRoot, 'portals', PORTAL.dest)
console.log(`Copying ${dist} -> ${dest}`)
copyDir(dist, dest)
console.log('\nPortal bundle is in', dest)
