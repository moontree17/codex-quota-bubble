const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quotaApp", {
  getQuota: () => ipcRenderer.invoke("quota:get"),
  refresh: () => ipcRenderer.invoke("quota:refresh"),
  close: () => ipcRenderer.invoke("app:close"),
  onQuota: (callback) => ipcRenderer.on("quota:update", (_event, data) => callback(data))
});
