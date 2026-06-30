import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("billDesktop", {
  openImage: () => ipcRenderer.invoke("dialog:openImage"),
  printBill: () => ipcRenderer.invoke("print:bill")
});
