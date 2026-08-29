import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  shell
} from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { defaultDbPath, JsonStore } from '../server/store'
import { startApiServer } from '../server'
import { loadConfig } from '../server/config'

const PROTOCOL = 'jargon'
let apiBaseUrl = process.env.JARGON_API_URL ?? 'http://127.0.0.1:8787'
let mainWindow: BrowserWindow | null = null

function tokenFilePath(): string {
  return join(app.getPath('userData'), 'auth-token.bin')
}

function saveToken(token: string | null): void {
  const path = tokenFilePath()
  if (!token) {
    if (existsSync(path)) unlinkSync(path)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(token))
  } else {
    writeFileSync(path, Buffer.from(token, 'utf8'))
  }
}

function loadToken(): string | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    const buf = readFileSync(path)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    return buf.toString('utf8')
  } catch {
    return null
  }
}

function sendDeepLink(url: string): void {
  if (mainWindow) {
    mainWindow.webContents.send('jargon:deep-link', url)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    if (url) sendDeepLink(url)
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  sendDeepLink(url)
})

function apiOrigin(): string {
  try {
    return new URL(apiBaseUrl).origin
  } catch {
    return ''
  }
}

// CSP lives here rather than in a meta tag so it can allow whichever API host
// the app was launched against (embedded localhost or hosted JARGON_API_URL).
function applyContentSecurityPolicy(): void {
  const dev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const connect = ["'self'", apiOrigin(), 'http://127.0.0.1:*', 'http://localhost:*']
  if (dev) connect.push('ws://127.0.0.1:*', 'ws://localhost:*')

  const policy = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connect.filter(Boolean).join(' ')}`
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({})
      return
    }
    const headers: Record<string, string[] | string> = {}
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (key.toLowerCase() === 'content-security-policy') continue
      headers[key] = value
    }
    headers['Content-Security-Policy'] = [policy]
    callback({ responseHeaders: headers })
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#fdf8ee',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      additionalArguments: [`--jargon-api=${apiBaseUrl}`]
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
    if (process.platform === 'darwin') {
      app.dock?.show()
      app.focus({ steal: true })
    }
  })

  // Fallback if ready-to-show never fires (blank/hung load)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 1500)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupIpc(): void {
  ipcMain.handle('jargon:get-auth-token', () => loadToken())
  ipcMain.handle('jargon:set-auth-token', (_e, token: string | null) => {
    saveToken(token)
    return true
  })
  ipcMain.handle('jargon:open-external', (_e, url: string) => {
    void shell.openExternal(url)
    return true
  })
  ipcMain.handle('jargon:get-api-base', () => apiBaseUrl)
}

app.whenReady().then(async () => {
  setupIpc()

  const remoteUrl = process.env.JARGON_API_URL
  if (remoteUrl) {
    apiBaseUrl = remoteUrl.replace(/\/$/, '')
    console.log(`[jargon] Using hosted API ${apiBaseUrl}`)
  } else {
    const store = new JsonStore(defaultDbPath(app.getPath('userData')))
    const config = loadConfig({
      host: '127.0.0.1',
      publicUrl: 'http://127.0.0.1:8787',
      previewUrl: process.env.JARGON_PREVIEW_URL ?? 'http://127.0.0.1:5173'
    })
    const { port, config: live } = await startApiServer(store, 8787, {
      host: '127.0.0.1',
      config
    })
    apiBaseUrl = live.publicUrl || `http://127.0.0.1:${port}`
    console.log(`[jargon] Embedded multi-tenant API on ${apiBaseUrl}`)
  }

  applyContentSecurityPolicy()
  await createWindow()

  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  } catch {
    /* optional until first published feed */
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
