import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { app, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let updateDownloaded = false
let quittingForUpdate = false

export function hasDownloadedUpdate() {
  return updateDownloaded
}

export function isQuittingForUpdate() {
  return quittingForUpdate
}

export function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message || err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available', info?.version || '')
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    const version = info?.version || 'a new version'
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Version ${version} has been downloaded.`,
        detail: 'Restart now to install it. If you choose Later, it installs the next time you quit CRM Employee.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) installDownloadedUpdate()
      })
      .catch(() => {})
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater]', err?.message || err)
    })
  }

  setTimeout(check, 8000)
  setInterval(check, CHECK_EVERY_MS)
}

export function installDownloadedUpdate() {
  if (!updateDownloaded) return false
  quittingForUpdate = true
  autoUpdater.quitAndInstall(true, true)
  return true
}
