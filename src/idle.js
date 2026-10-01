import { createRequire } from 'node:module'
import { applySession, createUserClient, localDateKey } from './attendance.js'
import { IDLE_FLUSH_MS, IDLE_GRACE_MS, IDLE_POLL_MS } from './config.js'
import { orgIdFromSession } from './session.js'

const require = createRequire(import.meta.url)
const { powerMonitor } = require('electron')

const GRACE_SEC = IDLE_GRACE_MS / 1000

export function businessUidFromSession(session) {
  const user = session?.user
  if (!user) return ''
  const meta = { ...(user.app_metadata || {}), ...(user.user_metadata || {}) }
  return String(meta.business_uid || meta.uid || meta.employeeId || user.id || '')
}

export class IdleTracker {
  constructor(readSession) {
    this.readSession = readSession
    this.timer = null
    this.tracking = false
    this.loaded = false
    this.dirty = false
    this.flushing = null
    this.streakCounted = 0
    this.lastPollAt = 0
    this.lastFlushAt = 0
    this.date = null
    this.uid = ''
    this.idleSeconds = 0
    this.generation = 0
  }

  start() {
    if (this.timer) return
    this.generation += 1
    this.tracking = true
    this.loaded = false
    this.lastPollAt = Date.now()
    this.timer = setInterval(() => {
      void this.poll()
    }, IDLE_POLL_MS)
    void this.poll()
  }

  async stop() {
    if (!this.tracking && !this.dirty && !this.timer) return
    const generation = this.generation
    this.tracking = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flush()
    if (generation !== this.generation) return
    this.loaded = false
    this.streakCounted = 0
  }

  systemIdleSeconds() {
    try {
      return Math.max(0, Number(powerMonitor.getSystemIdleTime()) || 0)
    } catch {
      return 0
    }
  }

  async poll() {
    if (!this.tracking) return
    const session = await this.readSession()
    if (!session) return

    const now = Date.now()
    const elapsed = Math.max(0, (now - this.lastPollAt) / 1000)
    this.lastPollAt = now
    const date = localDateKey()
    const uid = businessUidFromSession(session)
    if (!uid) return

    const needsLoad = !this.loaded || this.date !== date || this.uid !== uid
    if (needsLoad) {
      if (this.loaded && this.dirty) await this.flush()
      const loaded = await this.load(session, uid, date)
      if (!loaded) return
      const idleNow = this.systemIdleSeconds()
      this.streakCounted = idleNow >= GRACE_SEC ? idleNow : 0
      this.lastPollAt = Date.now()
      return
    }

    const idleSec = this.systemIdleSeconds()
    if (idleSec < GRACE_SEC) {
      this.streakCounted = 0
    } else if (this.streakCounted <= 0) {
      this.idleSeconds += idleSec
      this.streakCounted = idleSec
      this.dirty = true
    } else if (idleSec > this.streakCounted) {
      const delta = idleSec - this.streakCounted
      const capped = Math.min(delta, elapsed + 2)
      if (capped > 0) {
        this.idleSeconds += capped
        this.streakCounted += capped
        this.dirty = true
      }
    } else {
      this.streakCounted = idleSec
    }

    if (this.dirty && now - this.lastFlushAt >= IDLE_FLUSH_MS) {
      await this.flush()
    }
  }

  async load(session, uid, date) {
    const wrapped = createUserClient(session)
    if (!wrapped) return false
    const { client } = wrapped
    try {
      await applySession(client, session)
      const id = `${date}_${uid}`
      const { data, error } = await client.from('work_idle_days').select('data').eq('id', id).maybeSingle()
      if (error) throw error
      const stored = Number(data?.data?.idleSeconds) || 0
      this.uid = uid
      this.date = date
      this.idleSeconds = stored > 0 ? stored : 0
      this.loaded = true
      this.dirty = false
      return true
    } catch (err) {
      console.warn('[idle]', err?.message || err)
      return false
    }
  }

  async flush() {
    if (this.flushing) return this.flushing
    if (!this.dirty || !this.uid || !this.date) return
    this.flushing = this.write().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  async write() {
    const session = await this.readSession()
    if (!session) return
    const wrapped = createUserClient(session)
    if (!wrapped) return
    const { client } = wrapped
    const uid = this.uid
    const date = this.date
    const idleSeconds = Math.round(this.idleSeconds)
    const id = `${date}_${uid}`
    try {
      await applySession(client, session)
      const row = {
        id,
        user_id: uid,
        org_id: orgIdFromSession(session),
        auth_id: session.user?.id || null,
        data: {
          uid,
          date,
          idleSeconds,
          authId: session.user?.id || null,
        },
        updated_at: new Date().toISOString(),
      }
      const { error } = await client.from('work_idle_days').upsert(row, { onConflict: 'id' })
      if (error) throw error
      if (this.uid === uid && this.date === date) {
        this.dirty = false
        this.lastFlushAt = Date.now()
      }
    } catch (err) {
      console.warn('[idle]', err?.message || err)
    }
  }
}
