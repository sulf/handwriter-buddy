import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import updater from 'electron-updater'

// The printer bridge (HTTP on :8931 ↔ MQTT to the A1 Mini) runs inside the
// app's main process — no separate `npm run bridge` needed.
import '../server/bridge.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 960,
    title: 'Handwriter Buddy',
    backgroundColor: '#1f2d26',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  // external links (setup guide downloads etc.) open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Web Serial for the Ender 3: Electron has no built-in port picker, so
  // grant serial access and auto-pick the printer's USB adapter (prefer the
  // CH340 that Creality boards use, then any usbserial device).
  const ses = mainWindow.webContents.session
  // there may be several identical USB-serial adapters, so auto-picking is
  // unreliable — forward the list to the UI and let the user choose
  ses.on('select-serial-port', (event, ports, _wc, callback) => {
    event.preventDefault()
    serialPortCallback = callback
    mainWindow?.webContents.send(
      'serial-ports',
      ports.map((p) => ({
        portId: p.portId,
        portName: p.portName ?? '',
        displayName: p.displayName ?? '',
      })),
    )
  })
  ses.setPermissionCheckHandler(() => true)
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial')
  if (process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  // check GitHub releases; when an update has downloaded, tell the UI
  if (app.isPackaged) {
    updater.autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-ready', info.version)
    })
    updater.autoUpdater.checkForUpdates().catch((e) => {
      console.log('update check failed:', e?.message ?? e)
    })
  }
})

ipcMain.on('restart-to-update', () => {
  updater.autoUpdater.quitAndInstall()
})

let serialPortCallback = null
ipcMain.on('serial-port-chosen', (_e, portId) => {
  serialPortCallback?.(typeof portId === 'string' ? portId : '')
  serialPortCallback = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
