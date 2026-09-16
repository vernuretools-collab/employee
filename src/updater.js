import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { app, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message || err)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version || 'a new version'
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Version ${version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install when you quit the app.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true)
      })
      .catch(() => {})
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater]', err?.message || err)
    })
  }

  check()
  setInterval(check, CHECK_EVERY_MS)
}
