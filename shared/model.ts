import { z } from "zod";
import { dateKey, isDate } from "./dates";

export const isoDate = z.string().refine(isDate, "La fecha no es valida.");
export const caseInputSchema = z.object({
  number: z.string().trim().min(1, "Escribe el ID del caso.").max(80),
  title: z.string().trim().min(1, "Escribe una descripcion.").max(240),
  product: z.enum(["PostgreSQL", "MySQL", "Otro"]),
  status: z.enum(["work", "waiting"]),
  openedAt: isoDate
}).refine(value => value.openedAt <= dateKey(), {
  message: "La apertura no puede estar en el futuro.", path: ["openedAt"]
});
export const closeInputSchema = z.object({ id: z.uuid(), closedAt: isoDate });
export const idSchema = z.uuid();
export const caseRecordSchema = z.object({
  id: z.uuid(),
  number: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  product: z.enum(["PostgreSQL", "MySQL", "Otro"]),
  status: z.enum(["work", "waiting", "closed"]),
  openedAt: isoDate,
  closedAt: isoDate.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable()
}).refine(value => value.status === "closed"
  ? value.closedAt !== null && value.closedAt >= value.openedAt
  : value.closedAt === null, "Estado o fechas inconsistentes.");
export const eventSchema = z.object({
  id: z.uuid(), caseId: z.uuid(),
  action: z.enum(["created", "updated", "closed", "reopened", "deleted"]),
  at: z.iso.datetime(), record: caseRecordSchema
});
export const backupSchema = z.object({
  schemaVersion: z.literal(1), exportedAt: z.iso.datetime(),
  cases: z.array(caseRecordSchema).max(100000),
  events: z.array(eventSchema).max(500000)
});
export type CaseInput = z.infer<typeof caseInputSchema>;
export type CaseRecord = z.infer<typeof caseRecordSchema>;
export type Backup = z.infer<typeof backupSchema>;
export type CaseEvent = z.infer<typeof eventSchema>;
export interface AppState {
  cases: CaseRecord[];
  goal: number;
  dataPath: string;
  backupPath: string;
  version: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Api {
  state(): Promise<Result<AppState>>;
  create(input: CaseInput): Promise<Result<CaseRecord>>;
  update(id: string, input: CaseInput, closedAt: string | null): Promise<Result<CaseRecord>>;
  close(id: string, closedAt: string): Promise<Result<CaseRecord>>;
  reopen(id: string): Promise<Result<CaseRecord>>;
  remove(id: string): Promise<Result<void>>;
  exportBackup(): Promise<Result<string | null>>;
  importBackup(): Promise<Result<boolean>>;
  exportCsv(): Promise<Result<string | null>>;
  openData(): Promise<Result<void>>;
}
export class UserError extends Error {}
