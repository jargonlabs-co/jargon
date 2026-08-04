import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { defaultDbPath, JsonStore } from '../server/store'
import { startApiServer } from '../server'

let apiBaseUrl = 'http://127.0.0.1:8787'

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
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
    mainWindow.show()
  })

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

app.whenReady().then(async () => {
  const store = new JsonStore(defaultDbPath(app.getPath('userData')))
  const { port } = await startApiServer(store, 8787)
  apiBaseUrl = `http://127.0.0.1:${port}`
  console.log(`[jargon] API listening on ${apiBaseUrl}`)

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
