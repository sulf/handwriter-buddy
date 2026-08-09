// One-shot: render assets/icon.html to build/icon-1024.png with alpha.
// Run: npx electron electron/render-icon.mjs
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  })
  win.webContents.setFrameRate(1)
  await win.loadFile(path.join(__dirname, '../assets/icon.html'))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  fs.mkdirSync(path.join(__dirname, '../build'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '../build/icon-1024.png'), img.toPNG())
  console.log('wrote build/icon-1024.png')
  app.quit()
})
