// Bridge between the updater (main process) and the app UI.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hwb', {
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, version) => cb(version)),
  restartToUpdate: () => ipcRenderer.send('restart-to-update'),
  // Web Serial port picking: Electron has no native chooser, so the main
  // process forwards the OS port list and the UI answers with a portId.
  onSerialPorts: (cb) => ipcRenderer.on('serial-ports', (_e, ports) => cb(ports)),
  chooseSerialPort: (portId) => ipcRenderer.send('serial-port-chosen', portId),
})
