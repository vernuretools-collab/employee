import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const electron = require('electron')
const { app } = electron

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  dotenv.config({ path: filePath, override: true })
}

export function loadSupabaseEnv() {
  const roaming = process.env.APPDATA || ''
  const exeDir = path.dirname(process.execPath)
  const candidates = [
    path.join(APP_ROOT, '.env'),
    path.join(process.resourcesPath || '', '.env'),
    path.join(exeDir, '.env'),
    path.join(exeDir, 'resources', '.env'),
    path.join(roaming, 'CRM Employee', '.env'),
    path.join(roaming, 'crm-employee-desktop', '.env'),
  ]
  try {
    if (app?.isPackaged) {
      candidates.push(path.join(path.dirname(app.getPath('exe')), '.env'))
      candidates.push(path.join(app.getPath('userData'), '.env'))
    }
  } catch {
    /* app paths may be unavailable at import time */
  }
  for (const file of candidates) loadEnvFile(file)
}

loadSupabaseEnv()

export function isPackaged() {
  return Boolean(app?.isPackaged)
}

export function portalsRoot() {
  if (isPackaged()) return path.join(process.resourcesPath, 'portals')
  return path.join(APP_ROOT, 'portals')
}

export const APP_ID = 'employee'
export const APP_LABEL = 'Employee'
export const PARTITION = 'persist:crm-employee'

export const PORTALS = {
  employee: { id: 'employee', label: 'Employee', port: 3002, folder: 'employee' },
}

export function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
}

export function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
}

export const CAPTURE_INTERVAL_MS = 10 * 60 * 1000
export const IDLE_GRACE_MS = 20 * 60 * 1000
export const IDLE_POLL_MS = 15 * 1000
export const IDLE_FLUSH_MS = 60 * 1000
export const ATTENDANCE_POLL_MS = 20 * 1000
export const SCREENSHOT_BUCKET = 'work-screenshots'
