const SESSION_SCRIPT = `(() => {
  try {
    const pick = (parsed) => {
      const session = parsed?.currentSession || parsed?.session || parsed
      return session?.access_token ? session : null
    }
    const keys = Object.keys(localStorage)
    const preferred = keys.filter((k) => k.startsWith('sb-') && k.includes('auth-token'))
    for (const key of preferred) {
      try {
        const session = pick(JSON.parse(localStorage.getItem(key)))
        if (session) return session
      } catch {}
    }
    for (const key of keys) {
      try {
        const session = pick(JSON.parse(localStorage.getItem(key)))
        if (session) return session
      } catch {}
    }
    return null
  } catch {
    return null
  }
})()`

export function identityIdsFromSession(session) {
  if (!session?.user) return []
  const user = session.user
  const meta = { ...(user.app_metadata || {}), ...(user.user_metadata || {}) }
  const ids = [user.id, meta.business_uid, meta.uid, meta.employeeId]
  return [...new Set(ids.filter(Boolean).map(String))]
}

export function orgIdFromSession(session) {
  const user = session?.user
  const meta = { ...(user?.app_metadata || {}), ...(user?.user_metadata || {}) }
  return String(meta.orgId || 'org_demo')
}

export function roleFromSession(session) {
  const user = session?.user
  const meta = { ...(user?.app_metadata || {}), ...(user?.user_metadata || {}) }
  return String(meta.role || '').toLowerCase()
}

export function isAdminRole(role) {
  return ['admin', 'owner', 'superadmin'].includes(String(role || '').toLowerCase())
}

export async function readSessionFromWindow(win) {
  if (!win || win.isDestroyed()) return null
  try {
    const session = await win.webContents.executeJavaScript(SESSION_SCRIPT, true)
    if (!session?.access_token) return null
    return session
  } catch {
    return null
  }
}
