import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { APP_ID, APP_LABEL, PARTITION, loadSupabaseEnv, supabaseAnonKey, supabaseUrl } from './config.js'
import { WorkMonitor } from './monitor.js'
import { portalDistExists, portalUrl, startPortalServers } from './staticServers.js'
import { appIcon, trayIcon } from './appIcon.js'
import { hasDownloadedUpdate, isQuittingForUpdate, setupAutoUpdater } from './updater.js'
import { readSessionFromWindow } from './session.js'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, session, screen, Notification } = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, 'preload.cjs')

let portalWindow = null
let timingWindow = null
const monitor = new WorkMonitor()
let tray = null
let servers = []
let isQuitting = false
let timingHiddenByUser = false
let timingExpanded = true
let lastMonitorClockedIn = false
let attendanceUi = {
  signedIn: false,
  clockedIn: false,
  isOnBreak: false,
  isOnLunch: false,
}

monitor.setPauseGetter(() => ({
  isOnBreak: Boolean(attendanceUi.isOnBreak),
  isOnLunch: Boolean(attendanceUi.isOnLunch),
}))

function isAutostartLaunch() {
  return process.argv.includes('--autostart') || Boolean(app.getLoginItemSettings?.().wasOpenedAtLogin)
}

function sessionWindows() {
  return [timingWindow, portalWindow].filter((win) => win && !win.isDestroyed())
}

monitor.setSessionWindowsGetter(sessionWindows)
monitor.on('status', (status) => {
  const clockedIn = Boolean(status?.clockedIn)
  if (clockedIn && !lastMonitorClockedIn) {
    timingHiddenByUser = false
    attendanceUi.clockedIn = true
    attendanceUi.signedIn = true
    showMyTiming()
  }
  lastMonitorClockedIn = clockedIn
  updateTray()
})

function timingBoundsPath() {
  return path.join(app.getPath('userData'), 'my-timing-bounds.json')
}

function loadTimingBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(timingBoundsPath(), 'utf8'))
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed
  } catch {
    /* ignore */
  }
  return null
}

function saveTimingBounds() {
  if (!timingWindow || timingWindow.isDestroyed()) return
  try {
    fs.writeFileSync(timingBoundsPath(), JSON.stringify(timingWindow.getBounds()))
  } catch {
    /* ignore */
  }
}

const TIMING_WIDTH = 380
const TIMING_HEIGHT_COMPACT = 292
const TIMING_HEIGHT_EXPANDED = 640
const THEME_BG = {
  light: '#f7f7f5',
  dark: '#0f172a',
}

function applyWindowTheme(theme) {
  const bg = theme === 'dark' ? THEME_BG.dark : THEME_BG.light
  for (const win of sessionWindows()) {
    try {
      win.setBackgroundColor(bg)
    } catch {
      /* ignore */
    }
  }
}

function clampTimingPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + 8),
  })
  const area = display.workArea
  const minVisible = 72
  let nx = Math.round(x)
  let ny = Math.round(y)
  if (nx + width < area.x + minVisible) nx = area.x + minVisible - width
  if (nx > area.x + area.width - minVisible) nx = area.x + area.width - minVisible
  if (ny < area.y) ny = area.y
  if (ny > area.y + area.height - 36) ny = area.y + area.height - 36
  return { x: nx, y: ny }
}

function clampTimingBounds(bounds = {}, { expanded = timingExpanded } = {}) {
  const area = screen.getPrimaryDisplay().workArea
  const width = TIMING_WIDTH
  const maxExpanded = Math.min(TIMING_HEIGHT_EXPANDED + 160, Math.max(TIMING_HEIGHT_EXPANDED, area.height - 24))
  let height = expanded ? TIMING_HEIGHT_EXPANDED : TIMING_HEIGHT_COMPACT
  if (expanded && Number.isFinite(bounds.height) && bounds.height >= TIMING_HEIGHT_COMPACT) {
    height = Math.min(Math.max(bounds.height, TIMING_HEIGHT_EXPANDED), maxExpanded)
  }
  let x = Number.isFinite(bounds.x) ? bounds.x : Math.round(area.x + area.width - width - 24)
  let y = Number.isFinite(bounds.y) ? bounds.y : Math.round(area.y + 24)
  if (x + width > area.x + area.width) x = area.x + area.width - width - 16
  if (y + height > area.y + area.height) y = area.y + area.height - height - 16
  if (x < area.x) x = area.x + 16
  if (y < area.y) y = area.y + 16
  return { x: Math.round(x), y: Math.round(y), width, height }
}

function applyTimingSize({ expanded } = {}) {
  if (typeof expanded === 'boolean') timingExpanded = expanded
  if (!timingWindow || timingWindow.isDestroyed()) return
  const next = clampTimingBounds(timingWindow.getBounds(), { expanded: timingExpanded })
  const maxHeight = TIMING_HEIGHT_EXPANDED + 200
  timingWindow.setResizable(true)
  timingWindow.setMinimumSize(TIMING_WIDTH, TIMING_HEIGHT_COMPACT)
  timingWindow.setMaximumSize(TIMING_WIDTH, maxHeight)
  timingWindow.setBounds(next)
  if (!timingExpanded) {
    timingWindow.setMaximumSize(TIMING_WIDTH, TIMING_HEIGHT_COMPACT)
    timingWindow.setResizable(false)
  }
  saveTimingBounds()
}

function hideInsteadOfClose(win) {
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
}

const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
let appZoomFactor = 1

function hasCtrlOrCmd(input) {
  return Boolean(
    input.control ||
      input.meta ||
      (Array.isArray(input.modifiers) && (input.modifiers.includes('control') || input.modifiers.includes('meta'))),
  )
}

function zoomActionFromInput(input) {
  if (input.type !== 'keyDown' || input.isComposing || input.alt || !hasCtrlOrCmd(input)) return null
  const key = String(input.key || '')
  const code = String(input.code || '')
  if (key === '+' || key === '=' || key === 'Add' || key === 'Plus' || code === 'Equal' || code === 'NumpadAdd') {
    return 'in'
  }
  if (key === '-' || key === '_' || key === 'Subtract' || code === 'Minus' || code === 'NumpadSubtract') {
    return 'out'
  }
  if (!input.shift && (key === '0' || code === 'Digit0' || code === 'Numpad0')) return 'reset'
  return null
}

function applyZoom(win, factor) {
  if (!win || win.isDestroyed()) return
  const contents = win.webContents
  if (typeof contents.setZoomFactor === 'function') {
    try {
      contents.setZoomFactor(factor)
    } catch {
      /* ignore */
    }
  }
  contents.send('desktop:zoomFactor', factor)
}

function zoomSession(direction) {
  if (direction === 'reset') appZoomFactor = 1
  else if (direction === 'in') appZoomFactor = Math.min(ZOOM_MAX, Math.round((appZoomFactor + ZOOM_STEP) * 10) / 10)
  else appZoomFactor = Math.max(ZOOM_MIN, Math.round((appZoomFactor - ZOOM_STEP) * 10) / 10)
  for (const win of sessionWindows()) applyZoom(win, appZoomFactor)
}

function attachZoomShortcuts(win) {
  win.webContents.on('did-finish-load', () => applyZoom(win, appZoomFactor))
  win.webContents.on('before-input-event', (event, input) => {
    const action = zoomActionFromInput(input)
    if (!action) return
    event.preventDefault()
    zoomSession(action)
  })
}

function installAppMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => zoomSession('in') },
          { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', visible: false, click: () => zoomSession('in') },
          { label: 'Zoom In', accelerator: 'CommandOrControl+numadd', visible: false, click: () => zoomSession('in') },
          { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => zoomSession('out') },
          { label: 'Reset Zoom', accelerator: 'CommandOrControl+0', click: () => zoomSession('reset') },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  )
}

function updateTray() {
  if (!tray) return
  const monitorStatus = monitor.getStatus()
  const clockedIn = Boolean(attendanceUi.clockedIn || monitorStatus.clockedIn)
  const onBreak = Boolean(attendanceUi.isOnBreak)
  const onLunch = Boolean(attendanceUi.isOnLunch)
  const signedIn = Boolean(attendanceUi.signedIn)
  const timingVisible = Boolean(timingWindow && !timingWindow.isDestroyed() && timingWindow.isVisible())
  const label = monitorStatus.monitoring
    ? 'Monitoring (clocked in)'
    : clockedIn
      ? onLunch
        ? 'On lunch'
        : onBreak
          ? 'On break'
          : 'Clocked in'
      : 'Idle'
  tray.setToolTip(`CRM Employee — ${label}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      {
        label: timingVisible ? 'Hide My Timing' : 'Show My Timing',
        click: () => {
          if (timingVisible) hideMyTiming({ userHidden: true })
          else showMyTiming({ userShow: true })
        },
      },
      {
        label: 'Clock In',
        enabled: signedIn && !clockedIn,
        click: () => dispatchAttendanceAction('clockIn'),
      },
      {
        label: onBreak ? 'Resume' : 'Break',
        enabled: signedIn && clockedIn,
        click: () => dispatchAttendanceAction(onBreak ? 'resume' : 'break'),
      },
      {
        label: 'Clock Out',
        enabled: signedIn && clockedIn,
        click: () => dispatchAttendanceAction('clockOut'),
      },
      { type: 'separator' },
      { label: 'Open Employee', click: () => openPortal() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}

function createTray() {
  tray = new Tray(trayIcon())
  updateTray()
}

function browserOpts(extra = {}) {
  const { preload, sandbox, partition, ...rest } = extra
  return {
    width: 1280,
    height: 860,
    show: true,
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: preload || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: sandbox !== false,
      partition: partition || PARTITION,
    },
    ...rest,
  }
}

async function maybeShowScreenshotNotice() {
  const noticePath = path.join(app.getPath('userData'), 'screenshot-notice-accepted')
  if (fs.existsSync(noticePath)) return
  await dialog.showMessageBox({
    type: 'info',
    title: 'Work screenshots',
    message: 'This desktop app captures your primary screen every 10 minutes while you are clocked in.',
    detail:
      'Captures are uploaded to your company workspace for admins to review. The tray icon shows Monitoring while this is active. Clock out to stop.',
    buttons: ['I understand'],
  })
  fs.writeFileSync(noticePath, new Date().toISOString())
}

function portalHref(routePath = '') {
  const base = portalUrl(APP_ID)
  const trimmed = String(routePath || '').replace(/^\//, '')
  return trimmed ? `${base}${trimmed}` : base
}

async function openPortal({ show = true, path: routePath = '' } = {}) {
  if (!portalDistExists(APP_ID)) {
    await dialog.showErrorBox(
      'Portal missing',
      'Employee portal build missing. From crm-employee-desktop run npm run portals.',
    )
    return
  }
  if (show) await maybeShowScreenshotNotice()
  if (portalWindow && !portalWindow.isDestroyed()) {
    if (show) {
      if (routePath) portalWindow.loadURL(portalHref(routePath))
      portalWindow.show()
      portalWindow.focus()
      if (!routePath) portalWindow.webContents.reloadIgnoringCache()
    }
    return portalWindow
  }
  const win = new BrowserWindow({
    ...browserOpts({
      preload: preloadPath,
      sandbox: false,
      show,
    }),
    title: `${APP_LABEL} portal`,
  })
  portalWindow = win
  attachZoomShortcuts(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  hideInsteadOfClose(win)
  win.on('closed', () => {
    portalWindow = null
  })
  win.on('hide', () => {
    if (!timingHiddenByUser && attendanceUi.signedIn) showMyTiming()
  })
  win.on('minimize', () => {
    if (!timingHiddenByUser && attendanceUi.signedIn) showMyTiming()
  })
  win.on('focus', () => {
    if (timingHiddenByUser) return
    if (!timingWindow || timingWindow.isDestroyed() || !timingWindow.isVisible()) return
    timingWindow.setAlwaysOnTop(true, 'screen-saver')
    timingWindow.moveTop()
  })
  win.webContents.once('did-finish-load', () => {
    revealTimingIfSession()
  })
  win.loadURL(portalHref(routePath))
  return win
}

function ensureTimingWindow() {
  if (timingWindow && !timingWindow.isDestroyed()) return timingWindow
  if (!portalDistExists(APP_ID)) return null
  const bounds = clampTimingBounds(loadTimingBounds() || {})
  const win = new BrowserWindow({
    ...browserOpts({
      preload: preloadPath,
      sandbox: false,
      show: false,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#f7f7f5',
    }),
    title: 'My Timing',
  })
  timingWindow = win
  attachZoomShortcuts(win)
  hideInsteadOfClose(win)
  win.setMinimumSize(TIMING_WIDTH, TIMING_HEIGHT_COMPACT)
  win.setMaximumSize(TIMING_WIDTH, TIMING_HEIGHT_EXPANDED + 160)
  win.on('hide', () => updateTray())
  win.on('show', () => updateTray())
  win.on('moved', saveTimingBounds)
  win.on('resized', saveTimingBounds)
  win.on('closed', () => {
    timingWindow = null
  })
  win.loadURL(`${portalUrl(APP_ID)}desktop-timing`)
  return win
}

function showMyTiming({ userShow = false } = {}) {
  if (userShow) timingHiddenByUser = false
  const win = ensureTimingWindow()
  if (!win) return null
  win.setBounds(clampTimingBounds(win.getBounds()))
  if (win.isMinimized()) win.restore()
  win.show()
  win.setAlwaysOnTop(true, 'screen-saver')
  win.moveTop()
  updateTray()
  return win
}

async function revealTimingIfSession() {
  if (timingHiddenByUser) return
  const session = (await readSessionFromWindow(portalWindow)) || (await readSessionFromWindow(timingWindow))
  if (!session) return
  attendanceUi.signedIn = true
  showMyTiming()
}

function hideMyTiming({ userHidden = false } = {}) {
  if (userHidden) timingHiddenByUser = true
  if (timingWindow && !timingWindow.isDestroyed()) timingWindow.hide()
  updateTray()
}

async function dispatchAttendanceAction(action) {
  let win = timingWindow && !timingWindow.isDestroyed() ? timingWindow : null
  if (!win) win = portalWindow && !portalWindow.isDestroyed() ? portalWindow : null
  if (!win) {
    await openPortal({ show: true })
    win = portalWindow
  }
  if (!win || win.isDestroyed()) return
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
  }
  const safeAction = String(action || '').replace(/[^a-zA-Z]/g, '')
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('crm-desktop-attendance', { detail: { action: ${JSON.stringify(safeAction)} } }))`,
  )
}

function handleAttendanceChanged(payload = {}) {
  const prevClockedIn = attendanceUi.clockedIn
  if (payload.signedIn === false) {
    revealTimingIfSession().then(async () => {
      const session = (await readSessionFromWindow(portalWindow)) || (await readSessionFromWindow(timingWindow))
      if (session) return
      attendanceUi.signedIn = false
      if (timingWindow && !timingWindow.isDestroyed()) timingWindow.hide()
      updateTray()
    })
    return
  }
  attendanceUi = {
    signedIn: payload.signedIn == null ? attendanceUi.signedIn : Boolean(payload.signedIn),
    clockedIn: Boolean(payload.clockedIn),
    isOnBreak: Boolean(payload.isOnBreak),
    isOnLunch: Boolean(payload.isOnLunch),
  }
  const action = payload.action || (!prevClockedIn && attendanceUi.clockedIn ? 'clockIn' : null)
  if (action === 'clockIn') timingHiddenByUser = false
  if ((attendanceUi.signedIn || attendanceUi.clockedIn) && (action === 'clockIn' || !timingHiddenByUser)) {
    showMyTiming()
  }
  updateTray()
  monitor.tick()
}

function enableLoginItem() {
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
    path: app.getPath('exe'),
    args: ['--autostart'],
  })
}

const recentNativeTags = new Map()
const NATIVE_TAG_TTL_MS = 30_000

function normalizePortalPath(routePath = '') {
  const raw = String(routePath || '').trim()
  if (!raw) return ''
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      return `${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    /* keep raw path */
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

function showNativeNotification(payload = {}) {
  const title = String(payload.title || APP_LABEL).trim() || APP_LABEL
  const body = String(payload.body || '')
  const tag = String(payload.tag || `${title}:${body}`)
  const now = Date.now()
  const last = recentNativeTags.get(tag)
  if (last && now - last < NATIVE_TAG_TTL_MS) return false
  recentNativeTags.set(tag, now)
  for (const [key, at] of recentNativeTags) {
    if (now - at > NATIVE_TAG_TTL_MS) recentNativeTags.delete(key)
  }
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title,
    body,
    icon: appIcon(),
    silent: false,
  })
  n.on('click', () => {
    void openPortal({ show: true, path: normalizePortalPath(payload.link) })
  })
  n.show()
  return true
}

function registerIpc() {
  ipcMain.handle('desktop:getStatus', () => monitor.getStatus())
  ipcMain.handle('desktop:portalReady', () => ({
    employee: portalDistExists(APP_ID),
    supabaseConfigured: Boolean(supabaseUrl() && supabaseAnonKey()),
  }))
  ipcMain.handle('desktop:attendanceChanged', async (_event, payload) => {
    handleAttendanceChanged(payload || {})
    return true
  })
  ipcMain.handle('desktop:showMyTiming', async () => {
    showMyTiming({ userShow: true })
    return true
  })
  ipcMain.handle('desktop:hideMyTiming', async () => {
    hideMyTiming({ userHidden: true })
    return true
  })
  ipcMain.handle('desktop:openEmployeePortal', async (_event, payload) => {
    await openPortal({ show: true, path: payload?.path })
    return true
  })
  ipcMain.handle('desktop:setMyTimingSize', async (_event, payload) => {
    applyTimingSize({ expanded: Boolean(payload?.expanded) })
    return true
  })
  ipcMain.handle('desktop:setTheme', async (_event, theme) => {
    applyWindowTheme(theme === 'dark' ? 'dark' : 'light')
    return true
  })
  ipcMain.on('desktop:moveMyTimingBy', (event, payload = {}) => {
    if (!timingWindow || timingWindow.isDestroyed()) return
    if (event.sender !== timingWindow.webContents) return
    const dx = Number(payload.dx)
    const dy = Number(payload.dy)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
    const bounds = timingWindow.getBounds()
    const next = clampTimingPosition(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height)
    timingWindow.setPosition(next.x, next.y, false)
  })
  ipcMain.handle('desktop:showNotification', async (_event, payload) => showNativeNotification(payload || {}))
}

app.setName('CRM Employee')
app.setAppUserModelId('com.businessos.crm-employee')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    openPortal({ show: true })
  })
}

app.whenReady().then(async () => {
  if (!gotLock) return
  loadSupabaseEnv()
  const desktopSession = session.fromPartition(PARTITION)
  const allowedPermissions = new Set([
    'media',
    'display-capture',
    'clipboard-sanitized-write',
    'geolocation',
  ])
  desktopSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })
  desktopSession.setPermissionCheckHandler(() => true)
  registerIpc()
  installAppMenu()
  try {
    servers = await startPortalServers()
  } catch (err) {
    console.warn('[servers]', err)
  }
  enableLoginItem()
  setupAutoUpdater()
  createTray()
  monitor.start()
  const autostart = isAutostartLaunch()
  await openPortal({ show: !autostart })
  if (autostart) {
    setTimeout(() => revealTimingIfSession(), 1500)
    setTimeout(() => revealTimingIfSession(), 4000)
  }
  app.on('activate', () => {
    openPortal({ show: true })
  })
})

app.on('window-all-closed', () => {
  // Stay in the tray.
})

app.on('before-quit', (event) => {
  if (isQuitting || isQuittingForUpdate() || hasDownloadedUpdate()) return
  event.preventDefault()
  isQuitting = true
  saveTimingBounds()
  const flush = Promise.resolve(monitor.stop())
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000))
  Promise.race([flush, timeout]).finally(() => {
    for (const server of servers) {
      try {
        server.close()
      } catch {
        /* ignore */
      }
    }
    app.quit()
  })
})
