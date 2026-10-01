import { EventEmitter } from 'node:events'
import { ATTENDANCE_POLL_MS, CAPTURE_INTERVAL_MS } from './config.js'
import { isEmployeeClockedIn } from './attendance.js'
import { IdleTracker } from './idle.js'
import { capturePrimaryJpeg, uploadWorkScreenshot } from './screenshot.js'
import { readSessionFromWindow } from './session.js'

export class WorkMonitor extends EventEmitter {
  constructor() {
    super()
    this.getSessionWindows = () => []
    this.getPause = () => ({ isOnBreak: false, isOnLunch: false })
    this.pollTimer = null
    this.captureTimer = null
    this.uploading = false
    this.idle = new IdleTracker(() => this.readSession())
    this.status = {
      monitoring: false,
      clockedIn: false,
      lastCaptureAt: null,
      lastError: null,
      message: 'Idle',
    }
  }

  setSessionWindowsGetter(getter) {
    this.getSessionWindows = typeof getter === 'function' ? getter : () => []
    this.tick()
  }

  setPauseGetter(getter) {
    this.getPause = typeof getter === 'function' ? getter : () => ({ isOnBreak: false, isOnLunch: false })
  }

  pauseMessage() {
    const pause = this.getPause() || {}
    if (pause.isOnLunch) return 'On lunch'
    if (pause.isOnBreak) return 'On break'
    return null
  }

  sessionWindows() {
    return (this.getSessionWindows() || []).filter((win) => win && !win.isDestroyed())
  }

  async readSession() {
    for (const win of this.sessionWindows()) {
      const session = await readSessionFromWindow(win)
      if (session) return session
    }
    return null
  }

  start() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.tick(), ATTENDANCE_POLL_MS)
    this.tick()
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    return this.stopCapture('Stopped')
  }

  getStatus() {
    return { ...this.status }
  }

  setStatus(partial) {
    this.status = { ...this.status, ...partial }
    this.emit('status', this.getStatus())
  }

  stopCapture(message) {
    if (this.captureTimer) clearInterval(this.captureTimer)
    this.captureTimer = null
    const flushed = this.idle.stop()
    this.setStatus({
      monitoring: false,
      message: message || 'Idle',
    })
    return flushed
  }

  startCapture() {
    if (this.captureTimer) return
    this.setStatus({ monitoring: true, message: 'Monitoring' })
    this.idle.start()
    this.captureNow()
    this.captureTimer = setInterval(() => this.captureNow(), CAPTURE_INTERVAL_MS)
  }

  async tick() {
    const session = await this.readSession()
    if (!session) {
      this.stopCapture('Sign in to the employee portal to enable screenshots')
      this.setStatus({ clockedIn: false })
      return
    }
    const attendance = await isEmployeeClockedIn(session)
    if (attendance.unreachable) {
      this.setStatus({
        lastError: attendance.error || 'Cannot reach attendance',
        message: this.status.monitoring ? this.status.message : 'Cannot reach attendance',
      })
      return
    }
    if (!attendance.clockedIn) {
      this.stopCapture('Clocked out')
      this.setStatus({ clockedIn: false, lastError: attendance.error || null })
      return
    }
    const paused = this.pauseMessage()
    if (paused) {
      this.stopCapture(paused)
      this.setStatus({ clockedIn: true, lastError: attendance.error || null })
      return
    }
    this.setStatus({ clockedIn: true, lastError: attendance.error || null })
    this.startCapture()
  }

  async captureNow() {
    if (this.uploading) return
    const session = await this.readSession()
    if (!session) return
    const attendance = await isEmployeeClockedIn(session)
    if (attendance.unreachable) return
    if (!attendance.clockedIn) {
      this.stopCapture('Clocked out')
      this.setStatus({ clockedIn: false })
      return
    }
    const paused = this.pauseMessage()
    if (paused) {
      this.stopCapture(paused)
      this.setStatus({ clockedIn: true })
      return
    }
    this.uploading = true
    try {
      const capture = await capturePrimaryJpeg()
      await uploadWorkScreenshot(session, capture)
      this.setStatus({
        monitoring: true,
        clockedIn: true,
        lastCaptureAt: new Date().toISOString(),
        lastError: null,
        message: 'Monitoring',
      })
    } catch (err) {
      const message = err?.message || String(err)
      console.warn('[screenshot]', message)
      this.setStatus({ lastError: message, message: 'Capture failed' })
    } finally {
      this.uploading = false
    }
  }
}
