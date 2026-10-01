import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/model";

const api: Api = {
  state: () => ipcRenderer.invoke("tracking:state"),
  create: input => ipcRenderer.invoke("tracking:create", input),
  update: (id, input, closedAt) => ipcRenderer.invoke("tracking:update", id, input, closedAt),
  close: (id, closedAt) => ipcRenderer.invoke("tracking:close", id, closedAt),
  reopen: id => ipcRenderer.invoke("tracking:reopen", id),
  remove: id => ipcRenderer.invoke("tracking:remove", id),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  exportCsv: () => ipcRenderer.invoke("tracking:csv"),
  openData: () => ipcRenderer.invoke("tracking:folder")
};
contextBridge.exposeInMainWorld("cierres", Object.freeze(api));
