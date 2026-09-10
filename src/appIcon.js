import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { nativeImage } = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function appIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.png'),
  ]
  return candidates.find((p) => p && fs.existsSync(p))
}

export function appIcon() {
  const file = appIconPath()
  if (!file) return undefined
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? undefined : image
}

export function trayIcon() {
  const icon = appIcon()
  if (!icon) return nativeImage.createEmpty()
  return icon.resize({ width: 32, height: 32 })
}
