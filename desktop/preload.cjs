const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  retry: () => ipcRenderer.invoke('desktop:retry'),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  openLogsDir: () => ipcRenderer.invoke('desktop:open-logs-dir'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
});
