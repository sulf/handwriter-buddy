// Bridge between the updater (main process) and the app UI.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hwb', {
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, version) => cb(version)),
  restartToUpdate: () => ipcRenderer.send('restart-to-update'),
})
