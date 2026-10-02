import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, session, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { dateKey } from "../shared/dates";
import { z } from "zod";
import { caseInputSchema, closeInputSchema, idSchema, isoDate, todoInputSchema, UserError, type Result, type TodoRecord } from "../shared/model";
import { csv, errorMessage, Store } from "./store";
import { resolveDataFolder } from "./data-path";
import { ReminderScheduler } from "./reminders";

app.setName("Cierres");
if (process.platform === "win32") app.setAppUserModelId("local.cierres.desktop");
try {
  const folder = resolveDataFolder(app.getPath("appData"), app.isPackaged, process.env);
  mkdirSync(folder, { recursive: true });
  app.setPath("userData", folder);
  app.setPath("sessionData", folder);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("No se pudo abrir la carpeta de datos", `${message}\n\nUsa una carpeta con permisos de escritura. No se cambiara a otra base de datos.`);
  process.exit(1);
}
const dataFolder = app.getPath("userData");
const backupFolder = path.join(dataFolder, "backups");
let window: BrowserWindow | null = null;
let store: Store | undefined;
let backupDay = "";
let tray: Tray | undefined;
let quitting = false;
let scheduler: ReminderScheduler | undefined;
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let reminderError = "";
const notifications = new Set<Notification>();
const isDev = !app.isPackaged && process.argv.includes("--dev");
const logError = (error: unknown) => {
  const text = error instanceof Error ? error.stack || error.message : String(error);
  console.error(text);
  appendFileSync(path.join(dataFolder, "errors.log"), `${new Date().toISOString()} ${text}\n`, "utf8");
};

function backupToday(): void {
  if (backupDay !== dateKey()) {
    store!.snapshot(backupFolder);
    backupDay = dateKey();
  }
}
function atomicWrite(file: string, content: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, file);
}
function showWindow(openTodos = false): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  if (openTodos) window.webContents.send("todos:open");
}
function todosChanged(): void {
  if (window && !window.isDestroyed()) window.webContents.send("todos:changed");
}
function deliverReminder(item: TodoRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!Notification.isSupported()) {
      reject(new UserError("Windows no permite notificaciones en este entorno. Revisa tus tareas en To Do."));
      return;
    }
    const notification = new Notification({
      title: "Cierres - Recordatorio To Do", body: item.title,
      icon: path.join(__dirname, "..", "assets", "icon.png")
    });
    notifications.add(notification);
    const timeout = setTimeout(() => {
      notification.close();
      notifications.delete(notification);
      reject(new Error("Windows no confirmo la notificacion. Revisa los permisos de notificaciones."));
    }, 15000);
    notification.once("show", () => { clearTimeout(timeout); resolve(); });
    notification.once("failed", (_event, message) => {
      clearTimeout(timeout); notifications.delete(notification);
      reject(new Error(`No se pudo mostrar el recordatorio: ${message}`));
    });
    notification.once("click", () => { showWindow(true); notifications.delete(notification); });
    notification.once("close", () => { notifications.delete(notification); });
    notification.show();
  });
}
function handle(channel: string, operation: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<unknown>> => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new UserError("Solicitud no autorizada.");
      backupToday();
      return { ok: true, value: await operation(...args) };
    } catch (error) {
      logError(error);
      return { ok: false, error: errorMessage(error) };
    }
  });
}
function registerApi(): void {
  handle("tracking:state", () => ({
    cases: store!.list(), todos: store!.listTodos(), reminderError,
    goal: 5, dataPath: path.join(dataFolder, "tracking.sqlite"),
    backupPath: backupFolder, version: app.getVersion()
  }));
  handle("tracking:create", input => store!.create(caseInputSchema.parse(input)));
  handle("tracking:update", (id, input, closedAt) =>
    store!.update(idSchema.parse(id), caseInputSchema.parse(input), isoDate.nullable().parse(closedAt)));
  handle("tracking:close", (id, date) => {
    const input = closeInputSchema.parse({ id, closedAt: date });
    return store!.close(input.id, input.closedAt);
  });
  handle("tracking:reopen", id => store!.reopen(idSchema.parse(id)));
  handle("tracking:remove", id => store!.remove(idSchema.parse(id)));
  handle("todos:create", input => store!.createTodo(todoInputSchema.parse(input)));
  handle("todos:update", (id, input) => store!.updateTodo(idSchema.parse(id), todoInputSchema.parse(input)));
  handle("todos:complete", (id, completed) => store!.completeTodo(idSchema.parse(id), z.boolean().parse(completed)));
  handle("todos:remove", id => store!.removeTodo(idSchema.parse(id)));
  handle("app:quit", () => { setImmediate(() => app.quit()); });
  handle("tracking:folder", async () => {
    const error = await shell.openPath(dataFolder);
    if (error) throw new UserError(`No se pudo abrir la carpeta: ${error}`);
  });
  handle("backup:export", async () => {
    const result = await dialog.showSaveDialog(window!, {
      title: "Guardar respaldo completo", defaultPath: `cierres-respaldo-${dateKey()}.json`,
      filters: [{ name: "Respaldo de Cierres", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    atomicWrite(result.filePath, JSON.stringify(store!.backup(), null, 2));
    return result.filePath;
  });
  handle("tracking:csv", async () => {
    const result = await dialog.showSaveDialog(window!, {
      title: "Exportar todos los casos", defaultPath: `cierres-${dateKey()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (result.canceled || !result.filePath) return null;
    atomicWrite(result.filePath, csv(store!.list()));
    return result.filePath;
  });
  handle("backup:import", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "Restaurar respaldo de Cierres", properties: ["openFile"],
      filters: [{ name: "Respaldo de Cierres", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    const file = result.filePaths[0];
    if (statSync(file).size > 50 * 1024 * 1024) throw new UserError("El respaldo supera el limite de 50 MB.");
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) {
      if (error instanceof SyntaxError) throw new UserError("El archivo no contiene un respaldo JSON valido.");
      throw error;
    }
    const backup = store!.validateBackup(parsed);
    const confirmation = await dialog.showMessageBox(window!, {
      type: "warning", title: "Reemplazar tracking local",
      message: `Restaurar ${backup.cases.filter(item => !item.deletedAt).length} casos y ${backup.todos.filter(item => !item.deletedAt).length} tareas del respaldo?`,
      detail: "Esto reemplaza TODOS los casos y tareas actuales, no los combina. Un respaldo antiguo sin tareas elimina las tareas actuales. Antes se guardara una copia de seguridad en la carpeta backups.",
      buttons: ["Cancelar", "Restaurar respaldo"], defaultId: 0, cancelId: 0, noLink: true
    });
    if (confirmation.response !== 1) return false;
    store!.snapshot(backupFolder, `before-restore-${Date.now()}-${randomUUID()}`);
    store!.restore(backup);
    return true;
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    store = new Store(path.join(dataFolder, "tracking.sqlite"));
    backupToday();
    registerApi();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({
      width: 1380, height: 930, minWidth: 980, minHeight: 720,
      title: "Cierres", backgroundColor: "#111821", show: false,
      icon: path.join(__dirname, "..", "assets", "icon.png"),
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#1c2733", symbolColor: "#b4c4d2", height: 36 },
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false
      }
    });
    window.removeMenu();
    tray = new Tray(path.join(__dirname, "..", "assets", "icon.ico"));
    tray.setToolTip("Cierres - To Do y recordatorios activos");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Abrir Cierres", click: () => showWindow() },
      { label: "Abrir To Do", click: () => showWindow(true) },
      { type: "separator" },
      { label: "Salir (detener recordatorios)", click: () => app.quit() }
    ]));
    tray.on("double-click", () => showWindow());
    window.on("close", event => {
      if (!quitting) { event.preventDefault(); window?.hide(); }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.on("render-process-gone", (_event, details) => {
      logError(new Error(`Renderer ended: ${details.reason}`));
      dialog.showErrorBox("Cierres", "La interfaz se detuvo. Vuelve a abrir Cierres; el tracking confirmado sigue guardado.");
      app.quit();
    });
    window.once("ready-to-show", () => window?.show());
    if (isDev) await window.loadURL("http://127.0.0.1:5173");
    else {
      const index = path.join(__dirname, "..", "dist", "index.html");
      if (!existsSync(index)) throw new UserError("Falta compilar la interfaz. Ejecuta npm run build.");
      await window.loadFile(index);
    }
    window.show();
    scheduler = new ReminderScheduler(store, deliverReminder, backupToday,
      () => { reminderError = ""; todosChanged(); },
      error => {
        logError(error);
        reminderError = "No se pudo entregar un recordatorio. Revisa las notificaciones de Windows; se reintentara en 5 minutos. Puedes ver las tareas en To Do.";
        todosChanged();
      });
    reminderTimer = setInterval(() => { void scheduler?.check(); }, 15000);
    powerMonitor.on("resume", () => { void scheduler?.check(); });
    void scheduler.check();
  }).catch(error => {
    logError(error);
    dialog.showErrorBox("No se pudo iniciar Cierres", `${errorMessage(error)}\n\nDatos: ${dataFolder}`);
    app.quit();
  });
  app.on("before-quit", () => { quitting = true; scheduler?.stop(); });
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
  app.on("will-quit", () => {
    if (reminderTimer) clearInterval(reminderTimer);
    for (const notification of notifications) notification.close();
    tray?.destroy();
    store?.dispose();
  });
}
