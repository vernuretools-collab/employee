const { contextBridge, ipcRenderer, webFrame } = require('electron')

ipcRenderer.on('desktop:zoomFactor', (_event, factor) => {
  if (typeof factor === 'number' && factor > 0) webFrame.setZoomFactor(factor)
})

contextBridge.exposeInMainWorld('desktop', {
  getStatus: () => ipcRenderer.invoke('desktop:getStatus'),
  portalReady: () => ipcRenderer.invoke('desktop:portalReady'),
  attendanceChanged: (payload) => ipcRenderer.invoke('desktop:attendanceChanged', payload),
  showMyTiming: () => ipcRenderer.invoke('desktop:showMyTiming'),
  hideMyTiming: () => ipcRenderer.invoke('desktop:hideMyTiming'),
  openEmployeePortal: (payload) => ipcRenderer.invoke('desktop:openEmployeePortal', payload),
  setMyTimingSize: (payload) => ipcRenderer.invoke('desktop:setMyTimingSize', payload),
  showNotification: (payload) => ipcRenderer.invoke('desktop:showNotification', payload),
  onStatus: (fn) => {
    const listener = (_event, status) => fn(status)
    ipcRenderer.on('desktop:status', listener)
    return () => ipcRenderer.removeListener('desktop:status', listener)
  },
})
