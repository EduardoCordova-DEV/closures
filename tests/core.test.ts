import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, dateKey, daysBetween, formatDate, inWeek, isDate, isWorkday, weekEnd, weekLabel, weekStart } from "../shared/dates";
import type { CaseInput } from "../shared/model";
import { csv, Store } from "../electron/store";

const fixture = (number = "CASE-1"): CaseInput => ({
  number, title: "Consulta de conectividad", product: "PostgreSQL", status: "work", openedAt: addDays(dateKey(), -14)
});
const closureToday = () => isWorkday(dateKey()) ? dateKey() : weekEnd(weekStart());
function withStore(operation: (store: Store, folder: string) => void): void {
  const folder = mkdtempSync(path.join(tmpdir(), "cierres-store-test-"));
  const store = new Store(path.join(folder, "tracking.sqlite"));
  try { operation(store, folder); }
  finally { store.dispose(); rmSync(folder, { recursive: true, force: true }); }
}

test("work weeks run Monday through Friday across month and year boundaries", () => {
  assert.equal(weekStart("2026-09-29"), "2026-09-28");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  assert.equal(weekEnd("2026-09-28"), "2026-10-02");
  assert.equal(weekEnd("2026-12-28"), "2027-01-01");
  assert.equal(weekStart(addDays("2026-09-28", 7)), "2026-10-05");
  assert.equal(weekLabel("2026-09-28"), `${formatDate("2026-09-28")} \u2014 ${formatDate("2026-10-02", true)}`);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(isDate("2026-02-29"), false);
  assert.equal(isDate("2026-04-31"), false);
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2026-9-2"), false);
  for (const day of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) {
    assert.equal(inWeek(day, "2026-09-28"), true);
    assert.equal(isWorkday(day), true);
  }
  assert.equal(inWeek("2026-09-27", "2026-09-28"), false);
  assert.equal(inWeek("2026-10-03", "2026-09-28"), false);
  assert.equal(inWeek("2026-10-04", "2026-09-28"), false);
  assert.equal(inWeek("2026-10-05", "2026-09-28"), false);
  assert.equal(inWeek(null, "2026-09-28"), false);
  assert.equal(isWorkday("2026-10-03"), false);
  assert.equal(isWorkday("2026-10-04"), false);
  assert.equal(isWorkday("invalid"), false);
});
test("case age counts elapsed calendar days including full weekends and date boundaries", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-01"), 0);
  assert.equal(daysBetween("2026-09-30", "2026-10-01"), 1);
  assert.equal(daysBetween("2026-09-25", "2026-09-28"), 3);
  assert.equal(daysBetween("2026-09-25", "2026-09-26"), 1);
  assert.equal(daysBetween("2026-09-25", "2026-09-27"), 2);
  assert.equal(daysBetween("2026-09-24", "2026-10-01"), 7);
  assert.equal(daysBetween("2026-09-17", "2026-10-01"), 14);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2);
  assert.throws(() => daysBetween("2026-02-29", "2026-03-01"), /validas/);
  assert.throws(() => daysBetween("2026-10-01", "invalid"), /validas/);
});
test("active registration is not a closure; SQLite survives reopening", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "cierres-persistence-test-"));
  const file = path.join(folder, "tracking.sqlite");
  let store = new Store(file);
  try {
    const created = store.create(fixture());
    assert.equal(created.closedAt, null);
    assert.equal(created.status, "work");
    store.close(created.id, closureToday());
    store.dispose();
    store = new Store(file);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].closedAt, closureToday());
    assert.equal(store.list()[0].number, "CASE-1");
    assert.equal(store.backup().events.length, 2);
  } finally { store.dispose(); rmSync(folder, { recursive: true, force: true }); }
});
test("duplicate IDs, future dates, repeated closure and opening bounds are rejected", () => withStore(store => {
  const item = store.create(fixture("Case-1"));
  assert.throws(() => store.create(fixture(" case-1 ")), /registrado/);
  assert.throws(() => store.create({ ...fixture("new"), openedAt: addDays(dateKey(), 1) }));
  assert.throws(() => store.close(item.id, "not-a-date"), /cierre/);
  assert.throws(() => store.close(item.id, addDays(item.openedAt, -1)), /cierre/);
  assert.throws(() => store.close(item.id, addDays(dateKey(), 1)), /cierre/);
  store.close(item.id, closureToday());
  assert.throws(() => store.close(item.id, closureToday()), /ya esta cerrado/);
  assert.equal(store.list().length, 1);
  assert.equal(store.backup().events.length, 2);
}));
test("backdated closure, editing, reopening, deletion and history stay consistent", () => withStore(store => {
  const first = store.create(fixture()), second = store.create(fixture("CASE-2"));
  const priorFriday = addDays(weekStart(), -3);
  const closed = store.close(first.id, priorFriday);
  assert.equal(inWeek(closed.closedAt, weekStart()), false);
  assert.equal(inWeek(closed.closedAt, addDays(weekStart(), -7)), true);
  assert.throws(() => store.update(second.id, fixture("CASE-1"), null), /registrado/);
  store.update(first.id, { ...fixture(), title: "Corregido" }, closureToday());
  assert.equal(store.list().find(item => item.id === first.id)?.closedAt, closureToday());
  store.reopen(first.id);
  assert.equal(store.list().find(item => item.id === first.id)?.closedAt, null);
  assert.equal(store.list().filter(item => item.status === "closed").length, 0);
  store.remove(first.id);
  assert.equal(store.list().length, 1);
  assert.throws(() => store.close(first.id, closureToday()), /eliminado/);
  assert.throws(() => store.create(fixture()), /registrado/);
  assert.equal(store.backup().cases.length, 2);
  assert.equal(store.backup().events.at(-1)?.action, "deleted");
}));
test("complete backups restore atomically and invalid backups preserve existing data", () => withStore((store, folder) => {
  const item = store.create(fixture());
  store.close(item.id, closureToday());
  const backup = store.backup();
  store.create(fixture("CASE-2"));
  const before = store.backup().cases.length;
  assert.throws(() => store.restore({ ...backup, cases: [...backup.cases, backup.cases[0]] }), /duplicados/);
  assert.equal(store.list().length, before);
  assert.throws(() => store.restore({ schemaVersion: 99 }));
  assert.equal(store.list().length, before);
  store.restore(backup);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].status, "closed");
  assert.equal(store.backup().events.length, backup.events.length);
  const snapshot = store.snapshot(path.join(folder, "backups"));
  const header = readFileSync(snapshot).subarray(0, 16).toString();
  assert.equal(header, "SQLite format 3\u0000");
  const restored = new Store(snapshot);
  try { assert.equal(restored.list()[0].number, "CASE-1"); }
  finally { restored.dispose(); }
}));
test("weekend closure and edit are rejected without altering stored tracking", () => withStore(store => {
  const item = store.create(fixture());
  const saturday = addDays(weekStart(), -2), sunday = addDays(weekStart(), -1);
  for (const day of [saturday, sunday]) {
    assert.throws(() => store.close(item.id, day), /lunes a viernes/);
    assert.equal(store.list()[0].status, "work");
    assert.equal(store.backup().events.length, 1);
  }
  store.close(item.id, closureToday());
  assert.throws(() => store.update(item.id, fixture(), saturday), /lunes a viernes/);
  assert.equal(store.list()[0].closedAt, closureToday());
  assert.equal(store.backup().events.length, 2);
}));
test("restoring old data preserves every date without counting weekends in the work week", () => withStore(store => {
  const item = store.create(fixture());
  store.close(item.id, closureToday());
  const backup = store.backup();
  backup.cases[0].closedAt = addDays(weekStart(), -1);
  store.restore(backup);
  assert.equal(store.list()[0].closedAt, backup.cases[0].closedAt);
  assert.equal(inWeek(store.list()[0].closedAt, addDays(weekStart(), -7)), false);
  assert.equal(store.backup().events.length, backup.events.length);
}));
test("CSV quoting and formula-like text are safe without altering stored values", () => withStore(store => {
  const item = store.create({ ...fixture("=1+1"), title: 'A,"B"\nC' });
  const output = csv(store.list());
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes(`"'=1+1"`));
  assert.ok(output.includes(`"A,""B""\nC"`));
  assert.equal(store.list()[0].number, item.number);
}));
