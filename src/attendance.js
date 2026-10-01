import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseUrl } from './config.js'
import { identityIdsFromSession } from './session.js'

const require = createRequire(import.meta.url)
const { net } = require('electron')

function isTransportError(error) {
  const message = String(error?.message || '')
  return (
    message.includes('fetch failed') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    error?.status === 0
  )
}

// Node's fetch inside the Electron main process often fails with
// "TypeError: fetch failed" while Chromium's stack can still reach Supabase.
export async function supabaseFetch(input, init) {
  const impls = []
  if (typeof net?.fetch === 'function') impls.push(net.fetch.bind(net))
  if (typeof globalThis.fetch === 'function') impls.push(globalThis.fetch.bind(globalThis))
  let lastError = null
  for (const impl of impls) {
    try {
      return await impl(input, init)
    } catch (error) {
      lastError = error
      if (!isTransportError(error)) throw error
    }
  }
  throw lastError || new TypeError('fetch failed')
}

function clientOptions() {
  return {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: supabaseFetch },
  }
}

function describeQueryError(error) {
  const cause = String(error?.details || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Caused by:'))
  if (!cause) return error?.message || 'Attendance request failed'
  return `${error.message} — ${cause.replace(/^Caused by:\s*/, '')}`
}

let lastWarned = ''
function warnAttendance(message) {
  if (!message || message === lastWarned) return
  lastWarned = message
  console.warn('[attendance]', message)
}

export function localDateKey(d = new Date()) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createUserClient(session) {
  const url = supabaseUrl()
  const key = supabaseAnonKey()
  if (!url || !key || !session?.access_token) return null
  const client = createClient(url, key, clientOptions())
  return { client, session }
}

export async function applySession(client, session) {
  await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token || '',
  })
}

export async function signInWithPassword(email, password) {
  const url = supabaseUrl()
  const key = supabaseAnonKey()
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env')
  const client = createClient(url, key, clientOptions())
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  })
  if (error) throw error
  if (!data.session?.access_token) throw new Error('Sign-in did not return a session')
  return data.session
}

function looksClockedIn(data = {}) {
  if (data.clockedIn === true || data.onDuty === true) return true
  const status = String(data.status || '').toLowerCase()
  return status === 'clocked_in' || status === 'on_duty'
}

function rowDate(row) {
  const data = row?.data || {}
  if (data.date) return String(data.date).slice(0, 10)
  const fromId = String(row?.id || '').split('_')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromId)) return fromId
  return ''
}

export async function isEmployeeClockedIn(session) {
  const wrapped = createUserClient(session)
  const ids = identityIdsFromSession(session)
  const uid = ids[0] || session.user?.id || null
  if (!wrapped) return { clockedIn: false, uid }
  const { client } = wrapped
  try {
    await applySession(client, session)
  } catch (error) {
    const cause = error?.cause?.message ? ` — ${error.cause.message}` : ''
    const message = `${error?.message || error}${cause}`
    warnAttendance(message)
    return { clockedIn: false, uid, error: message, unreachable: true }
  }
  const date = localDateKey()
  const docIds = ids.map((id) => `${date}_${id}`)
  if (!docIds.length && !ids.length) return { clockedIn: false, uid }

  let data = []
  let error = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    data = []
    error = null
    if (docIds.length) {
      const byId = await client.from('attendance_logs').select('id, user_id, data').in('id', docIds)
      error = byId.error
      data = byId.data || []
    }
    if (!error && !data.length && ids.length) {
      const byUser = await client.from('attendance_logs').select('id, user_id, data').in('user_id', ids)
      error = byUser.error
      data = byUser.data || []
    }
    if (!error || !isTransportError(error)) break
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
  }

  if (error) {
    const message = describeQueryError(error)
    warnAttendance(message)
    return { clockedIn: false, uid, error: message, unreachable: isTransportError(error) }
  }
  lastWarned = ''

  const todayRows = (data || []).filter((row) => {
    const d = rowDate(row)
    return !d || d === date || docIds.includes(row.id)
  })
  const row = todayRows.find((item) => looksClockedIn(item.data || {}))
  return {
    clockedIn: Boolean(row),
    uid: row?.user_id || row?.data?.uid || uid,
    date,
  }
}
