import { app, BrowserWindow, ipcMain } from 'electron'
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
