import { createRequire } from 'node:module'
import { applySession, createUserClient, localDateKey } from './attendance.js'
import { SCREENSHOT_BUCKET } from './config.js'
import { identityIdsFromSession, orgIdFromSession } from './session.js'

const require = createRequire(import.meta.url)
const { desktopCapturer, screen } = require('electron')

export async function capturePrimaryJpeg() {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const scale = display.scaleFactor || 1
  const maxW = 1600
  const fullW = Math.max(1, Math.round(width * scale))
  const fullH = Math.max(1, Math.round(height * scale))
  const ratio = Math.min(1, maxW / fullW)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(fullW * ratio)),
      height: Math.max(1, Math.round(fullH * ratio)),
    },
  })
  const source =
    sources.find((item) => String(item.display_id) === String(display.id)) || sources[0]
  if (!source?.thumbnail) throw new Error('No screen capture source available')
  const size = source.thumbnail.getSize()
  return {
    buffer: source.thumbnail.toJPEG(72),
    width: size.width,
    height: size.height,
  }
}

export async function uploadWorkScreenshot(session, capture) {
  const wrapped = createUserClient(session)
  if (!wrapped) throw new Error('Not signed in')
  const { client } = wrapped
  await applySession(client, session)

  const ids = identityIdsFromSession(session)
  const uid = ids[0] || session.user?.id
  if (!uid) throw new Error('Missing user id')

  const date = localDateKey()
  const storagePath = `${uid}/${date}/${Date.now()}.jpg`
  const { error: uploadError } = await client.storage
    .from(SCREENSHOT_BUCKET)
    .upload(storagePath, Buffer.from(capture.buffer), {
      contentType: 'image/jpeg',
      upsert: false,
    })
  if (uploadError) throw uploadError

  const row = {
    id: crypto.randomUUID(),
    user_id: uid,
    org_id: orgIdFromSession(session),
    auth_id: session.user?.id || null,
    captured_at: new Date().toISOString(),
    storage_path: storagePath,
    width: capture.width,
    height: capture.height,
  }
  const { error: insertError } = await client.from('work_screenshots').insert(row)
  if (insertError) throw insertError
  return row
}
