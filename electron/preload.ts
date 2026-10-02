import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/model";

const api: Api = {
  state: () => ipcRenderer.invoke("tracking:state"),
  create: input => ipcRenderer.invoke("tracking:create", input),
  update: (id, input, closedAt) => ipcRenderer.invoke("tracking:update", id, input, closedAt),
  close: (id, closedAt) => ipcRenderer.invoke("tracking:close", id, closedAt),
  reopen: id => ipcRenderer.invoke("tracking:reopen", id),
  remove: id => ipcRenderer.invoke("tracking:remove", id),
  createTodo: input => ipcRenderer.invoke("todos:create", input),
  updateTodo: (id, input) => ipcRenderer.invoke("todos:update", id, input),
  completeTodo: (id, completed) => ipcRenderer.invoke("todos:complete", id, completed),
  removeTodo: id => ipcRenderer.invoke("todos:remove", id),
  onTodosChanged: listener => {
    const handler = () => listener();
    ipcRenderer.on("todos:changed", handler);
    return () => { ipcRenderer.removeListener("todos:changed", handler); };
  },
  onOpenTodos: listener => {
    const handler = () => listener();
    ipcRenderer.on("todos:open", handler);
    return () => { ipcRenderer.removeListener("todos:open", handler); };
  },
  quit: () => ipcRenderer.invoke("app:quit"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  exportCsv: () => ipcRenderer.invoke("tracking:csv"),
  openData: () => ipcRenderer.invoke("tracking:folder")
};
contextBridge.exposeInMainWorld("cierres", Object.freeze(api));
