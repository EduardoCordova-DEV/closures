import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { dateKey } from "../shared/dates";
import type { TodoInput } from "../shared/model";
import { Store } from "../electron/store";
import { ReminderScheduler } from "../electron/reminders";

const input = (changes: Partial<TodoInput> = {}): TodoInput => ({
  title: "Revisar resultados", notes: "", dueDate: null, reminderAt: null, caseId: null, ...changes
});
const reminderAt = "2026-10-01T18:00:00.000Z";
const now = new Date(reminderAt);
async function withStore(run: (store: Store) => void | Promise<void>): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), "cierres-todos-"));
  const store = new Store(path.join(folder, "tracking.sqlite"));
  try { await run(store); }
  finally { store.dispose(); rmSync(folder, { recursive: true, force: true }); }
}

test("To Do CRUD, optional fields and case links do not modify case metrics", () => withStore(store => {
  const related = store.create({ number: "SYNTHETIC-CASE", title: "Prueba", product: "Otro", status: "waiting", openedAt: dateKey() });
  const todo = store.createTodo(input({ caseId: related.id, dueDate: "2026-10-03", reminderAt }));
  assert.equal(store.createTodo(input()).caseId, null);
  assert.throws(() => store.createTodo(input({ title: " " })));
  assert.throws(() => store.createTodo(input({ dueDate: "2026-02-30" })));
  assert.throws(() => store.createTodo(input({ reminderAt: "invalid" })));
  assert.throws(() => store.createTodo(input({ caseId: randomUUID() })), /caso ya no existe/);
  assert.equal(store.dueReminders(new Date(now.getTime() - 1)).length, 0);
  assert.equal(store.dueReminders(now)[0].id, todo.id);
  store.completeTodo(todo.id, true);
  assert.equal(store.dueReminders(now).length, 0);
  assert.equal(store.list()[0].status, "waiting");
  assert.equal(store.list()[0].closedAt, null);
  store.completeTodo(todo.id, false);
  assert.equal(store.dueReminders(now).length, 1);
  store.markReminderNotified(todo.id, reminderAt, now);
  assert.equal(store.dueReminders(now).length, 0);
  store.completeTodo(todo.id, true);
  store.completeTodo(todo.id, false);
  assert.equal(store.dueReminders(now).length, 0);
  store.updateTodo(todo.id, input({ caseId: related.id, title: "Corregido", reminderAt }));
  assert.equal(store.dueReminders(now).length, 0);
  const changedTime = "2026-10-01T17:00:00.000Z";
  store.updateTodo(todo.id, input({ caseId: related.id, reminderAt: changedTime }));
  store.markReminderNotified(todo.id, reminderAt, now);
  assert.equal(store.dueReminders(now).length, 1);
  store.remove(related.id);
  assert.equal(store.listTodos().find(item => item.id === todo.id)?.caseId, related.id);
  store.updateTodo(todo.id, input({ caseId: related.id, reminderAt: changedTime, notes: "Conservar vinculo" }));
  store.removeTodo(todo.id);
  assert.equal(store.dueReminders(now).length, 0);
  assert.equal(store.listTodos().length, 1);
  assert.equal(store.backup().todos.length, 2);
  assert.throws(() => store.completeTodo(todo.id, false), /eliminada/);
}));

test("v2 backups include tasks and notification state; invalid backups are atomic and v1 restores are supported", () => withStore(store => {
  const todo = store.createTodo(input({ reminderAt }));
  store.markReminderNotified(todo.id, reminderAt, now);
  const backup = store.backup();
  store.createTodo(input({ title: "Posterior" }));
  assert.throws(() => store.restore({ ...backup, todos: [...backup.todos, backup.todos[0]] }), /duplicadas/);
  assert.equal(store.listTodos().length, 2);
  assert.throws(() => store.restore({ ...backup, todos: [{ ...backup.todos[0], caseId: randomUUID() }] }), /inexistentes/);
  store.restore(backup);
  assert.equal(store.listTodos().length, 1);
  assert.equal(store.dueReminders(now).length, 0);
  const legacy = { schemaVersion: 1, exportedAt: backup.exportedAt, cases: backup.cases, events: backup.events };
  store.restore(legacy);
  assert.equal(store.listTodos().length, 0);
}));

test("v1 database migration preserves cases, snapshots before migration and persists tasks across restart", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "cierres-v2-migration-"));
  const file = path.join(folder, "tracking.sqlite");
  let store = new Store(file);
  try {
    store.create({ number: "MIGRATION-ONLY", title: "Caso de prueba", product: "Otro", status: "work", openedAt: dateKey() });
    store.dispose();
    const old = new DatabaseSync(file);
    old.exec("DROP TABLE todos; PRAGMA user_version=1;");
    old.close();
    store = new Store(file);
    assert.equal(store.list()[0].number, "MIGRATION-ONLY");
    assert.equal(store.backup().events.length, 1);
    const snapshot = readdirSync(path.join(folder, "backups")).find(name => name.startsWith("tracking-before-v2-"));
    assert.ok(snapshot);
    const prior = new DatabaseSync(path.join(folder, "backups", snapshot!), { readOnly: true });
    assert.equal(prior.prepare("PRAGMA user_version").get()?.user_version, 1);
    prior.close();
    const task = store.createTodo(input({ reminderAt }));
    store.markReminderNotified(task.id, reminderAt, now);
    store.dispose();
    store = new Store(file);
    assert.equal(store.listTodos()[0].reminderNotifiedAt, reminderAt);
    assert.equal(store.dueReminders(now).length, 0);
  } finally { store.dispose(); rmSync(folder, { recursive: true, force: true }); }
});

test("reminder failures are retried without marking delivery and successful delivery persists", () => withStore(async store => {
  const todo = store.createTodo(input({ reminderAt }));
  let attempts = 0, backups = 0, changed = 0;
  const errors: unknown[] = [];
  const scheduler = new ReminderScheduler(store, async () => {
    attempts++;
    if (attempts === 1) throw new Error("Notification disabled");
  }, () => { backups++; }, () => { changed++; }, error => errors.push(error));
  await scheduler.check(now);
  assert.equal(errors.length, 1);
  assert.equal(store.listTodos()[0].reminderNotifiedAt, null);
  await scheduler.check(new Date(now.getTime() + 60000));
  assert.equal(attempts, 1);
  await scheduler.check(new Date(now.getTime() + 300000));
  assert.equal(attempts, 2);
  assert.equal(backups, 2);
  assert.equal(changed, 1);
  assert.ok(store.listTodos().find(item => item.id === todo.id)?.reminderNotifiedAt);
  await scheduler.check(new Date(now.getTime() + 600000));
  assert.equal(attempts, 2);
}));

test("reminders avoid overlapping checks and skip tasks completed while another notification is pending", () => withStore(async store => {
  const first = store.createTodo(input({ reminderAt: "2026-10-01T17:00:00.000Z" }));
  const second = store.createTodo(input({ reminderAt }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delivered: string[] = [], errors: unknown[] = [];
  const scheduler = new ReminderScheduler(store, async item => { delivered.push(item.id); await gate; }, () => {}, () => {}, error => errors.push(error));
  const checking = scheduler.check(now);
  await scheduler.check(now);
  store.completeTodo(second.id, true);
  release();
  await checking;
  assert.deepEqual(delivered, [first.id]);
  assert.deepEqual(errors, []);
  store.completeTodo(second.id, false);
  scheduler.stop();
  await scheduler.check(now);
  assert.deepEqual(delivered, [first.id]);
}));
