import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dateKey, isDate, isWorkday } from "../shared/dates";
import {
  backupSchema, caseInputSchema, caseRecordSchema, UserError,
  type Backup, type CaseEvent, type CaseInput, type CaseRecord
} from "../shared/model";

export class Store {
  private db: DatabaseSync;
  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      const check = this.db.prepare("PRAGMA quick_check").get();
      if (check?.quick_check !== "ok") throw new UserError("La base de datos requiere recuperacion. No se reemplazo ningun dato.");
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > 1) throw new UserError("Esta base pertenece a una version mas reciente de Cierres.");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY, case_key TEXT NOT NULL UNIQUE, record TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), record TEXT NOT NULL
        );
        PRAGMA user_version=1;
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  dispose(): void { this.db.close(); }
  private key(number: string): string { return number.normalize("NFKC").toLocaleLowerCase("en-US"); }
  private all(): CaseRecord[] {
    return this.db.prepare("SELECT record FROM cases ORDER BY rowid DESC").all()
      .map(row => caseRecordSchema.parse(JSON.parse(String(row.record))));
  }
  list(): CaseRecord[] { return this.all().filter(item => !item.deletedAt); }
  private get(id: string): CaseRecord {
    const row = this.db.prepare("SELECT record FROM cases WHERE id=?").get(id);
    if (!row) throw new UserError("El caso ya no existe.");
    const record = caseRecordSchema.parse(JSON.parse(String(row.record)));
    if (record.deletedAt) throw new UserError("El caso fue eliminado.");
    return record;
  }
  private unique(number: string, id?: string): void {
    const existing = this.db.prepare("SELECT id FROM cases WHERE case_key=?").get(this.key(number));
    if (existing && existing.id !== id) throw new UserError("Ese ID ya esta registrado, incluso si el caso fue eliminado. Usa un ID distinto.");
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private save(record: CaseRecord, action: CaseEvent["action"]): CaseRecord {
    caseRecordSchema.parse(record);
    return this.transaction(() => {
      this.db.prepare("INSERT INTO cases(id,case_key,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET case_key=excluded.case_key,record=excluded.record")
        .run(record.id, this.key(record.number), JSON.stringify(record));
      const event: CaseEvent = { id: randomUUID(), caseId: record.id, action, at: new Date().toISOString(), record };
      this.db.prepare("INSERT INTO events(id,case_id,record) VALUES(?,?,?)").run(event.id, record.id, JSON.stringify(event));
      return record;
    });
  }
  create(input: CaseInput): CaseRecord {
    const clean = caseInputSchema.parse(input);
    this.unique(clean.number);
    const now = new Date().toISOString();
    return this.save({ ...clean, id: randomUUID(), closedAt: null, createdAt: now, updatedAt: now, deletedAt: null }, "created");
  }
  update(id: string, input: CaseInput, closedAt: string | null): CaseRecord {
    const previous = this.get(id), clean = caseInputSchema.parse(input);
    this.unique(clean.number, id);
    if (previous.status === "closed") this.validateClosure(clean.openedAt, closedAt);
    else if (closedAt !== null) throw new UserError("Usa Cerrar Caso para confirmar un cierre.");
    return this.save({
      ...previous, ...clean, status: previous.status === "closed" ? "closed" : clean.status,
      closedAt: previous.status === "closed" ? closedAt : null, updatedAt: new Date().toISOString()
    }, "updated");
  }
  private validateClosure(openedAt: string, closedAt: string | null): void {
    if (!closedAt || !isDate(closedAt) || closedAt < openedAt || closedAt > dateKey())
      throw new UserError("El cierre debe estar entre la apertura del caso y hoy.");
    if (!isWorkday(closedAt))
      throw new UserError("La fecha de cierre debe ser de lunes a viernes.");
  }
  close(id: string, closedAt: string): CaseRecord {
    const previous = this.get(id);
    if (previous.status === "closed") throw new UserError("Este caso ya esta cerrado. No se conto otra vez.");
    this.validateClosure(previous.openedAt, closedAt);
    return this.save({ ...previous, status: "closed", closedAt, updatedAt: new Date().toISOString() }, "closed");
  }
  reopen(id: string): CaseRecord {
    const previous = this.get(id);
    if (previous.status !== "closed") throw new UserError("Este caso ya esta activo.");
    return this.save({ ...previous, status: "work", closedAt: null, updatedAt: new Date().toISOString() }, "reopened");
  }
  remove(id: string): void {
    const now = new Date().toISOString();
    this.save({ ...this.get(id), deletedAt: now, updatedAt: now }, "deleted");
  }
  backup(): Backup {
    return backupSchema.parse({
      schemaVersion: 1, exportedAt: new Date().toISOString(), cases: this.all(),
      events: this.db.prepare("SELECT record FROM events ORDER BY rowid").all().map(row => JSON.parse(String(row.record)))
    });
  }
  validateBackup(input: unknown): Backup {
    const backup = backupSchema.parse(input);
    const ids = new Set<string>(), keys = new Set<string>(), events = new Set<string>();
    for (const item of backup.cases) {
      const key = this.key(item.number);
      if (ids.has(item.id) || keys.has(key)) throw new UserError("El respaldo contiene casos duplicados.");
      ids.add(item.id); keys.add(key);
    }
    for (const event of backup.events) {
      if (events.has(event.id) || !ids.has(event.caseId) || event.record.id !== event.caseId)
        throw new UserError("El historial del respaldo es inconsistente.");
      events.add(event.id);
    }
    return backup;
  }
  restore(input: unknown): void {
    const backup = this.validateBackup(input);
    this.transaction(() => {
      this.db.exec("DELETE FROM events; DELETE FROM cases;");
      const insert = this.db.prepare("INSERT INTO cases(id,case_key,record) VALUES(?,?,?)");
      for (const item of backup.cases) insert.run(item.id, this.key(item.number), JSON.stringify(item));
      const insertEvent = this.db.prepare("INSERT INTO events(id,case_id,record) VALUES(?,?,?)");
      for (const item of backup.events) insertEvent.run(item.id, item.caseId, JSON.stringify(item));
    });
  }
  snapshot(folder: string, label = dateKey()): string {
    mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `tracking-${label}.sqlite`);
    if (!existsSync(target)) this.db.prepare("VACUUM INTO ?").run(target);
    return target;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof UserError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message || "Revisa los datos ingresados.";
  return "No se pudo completar la operacion. Tus datos no se descartaron. Revisa el registro en la carpeta de datos.";
}

export function csv(records: CaseRecord[]): string {
  const escape = (value: string) => {
    const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = records.map(item => [
    item.number, item.title, item.product, { work: "En trabajo", waiting: "En espera", closed: "Cerrado" }[item.status],
    item.openedAt, item.closedAt || ""
  ].map(escape).join(","));
  return "\uFEFF" + ['"ID","Descripcion","Producto","Estado","Apertura","Cierre"', ...rows].join("\r\n");
}
