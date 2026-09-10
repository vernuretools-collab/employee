import { createClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseUrl } from './config.js'
import { identityIdsFromSession } from './session.js'

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
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
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
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
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
  await applySession(client, session)
  const date = localDateKey()
  const docIds = ids.map((id) => `${date}_${id}`)
  if (!docIds.length && !ids.length) return { clockedIn: false, uid }

  let data = []
  let error = null
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

  if (error) {
    console.warn('[attendance]', error.message)
    return { clockedIn: false, uid, error: error.message }
  }

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
