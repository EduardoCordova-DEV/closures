import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright";
import { addDays, dateKey, daysBetween, isWorkday, weekEnd, weekLabel, weekStart } from "../shared/dates";

const require = createRequire(import.meta.url);
const executablePath: string = require("electron");
async function count(page: Page, name: string, expected: number) {
  await page.waitForFunction(({ name, expected }) =>
    document.querySelector(`[data-testid="${name}"]`)?.textContent === String(expected), { name, expected });
}
async function age(page: Page, name: string, expected: string) {
  await page.waitForFunction(({ name, expected }) =>
    document.querySelector(`[data-testid="${name}"]`)?.textContent === expected, { name, expected });
}
async function ageTone(locator: Locator, level: "safe" | "warning" | "overdue") {
  const palette = {
    safe: { color: "rgb(182, 239, 208)", background: "rgb(35, 60, 50)", border: "rgb(69, 101, 83)" },
    warning: { color: "rgb(255, 224, 138)", background: "rgb(64, 53, 30)", border: "rgb(139, 114, 56)" },
    overdue: { color: "rgb(255, 192, 184)", background: "rgb(72, 42, 42)", border: "rgb(157, 85, 80)" }
  };
  const actual = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      className: element.className, color: style.color, background: style.backgroundColor,
      border: style.borderTopColor, inTable: !!element.closest(".col-age")
    };
  });
  assert.ok(actual.className.split(" ").includes(`age-${level}`));
  assert.equal(actual.color, palette[level].color);
  if (actual.inTable) {
    assert.equal(actual.background, palette[level].background);
    assert.equal(actual.border, palette[level].border);
  }
}
async function ageColumn(page: Page) {
  assert.equal(await page.getByRole("columnheader", { name: "D\u00cdAS ABIERTO", exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => {
    const label = document.querySelector<HTMLElement>('[data-testid="case-age"]')!;
    const cell = label.closest("td")!;
    const row = cell.parentElement!;
    const description = row.children[1];
    const status = row.children[3];
    const bounds = label.getBoundingClientRect(), cellBounds = cell.getBoundingClientRect();
    const panel = document.querySelector(".table-panel")!.getBoundingClientRect();
    const table = document.querySelector("table")!.getBoundingClientRect();
    return row.children.length === 5 && row.children[2] === cell &&
      !description.querySelector('[data-testid="case-age"]') && !!status.querySelector(".status") &&
      bounds.left >= cellBounds.left && bounds.right <= cellBounds.right &&
      cellBounds.left >= description.getBoundingClientRect().right &&
      cellBounds.right <= status.getBoundingClientRect().left &&
      Math.abs((bounds.left + bounds.right - cellBounds.left - cellBounds.right) / 2) < 1 &&
      Math.abs((bounds.top + bounds.bottom - cellBounds.top - cellBounds.bottom) / 2) < 1 &&
      Number.parseFloat(getComputedStyle(label).fontSize) >= 14 &&
      table.right <= panel.right && document.documentElement.scrollWidth <= innerWidth;
  }), true, "Case age must be large, centered in its own column and fully visible between description and status");
}
test("Electron registers, closes, edits and persists tracking through a full app restart", { timeout: 180000 }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "cierres-electron-test-"));
  const env: Record<string, string> = { CIERRES_TEST_MODE: "1", CIERRES_DATA_DIR: folder };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE" && key !== "CIERRES_TEST_MODE" && key !== "CIERRES_DATA_DIR") env[key] = value;
  }
  let application: ElectronApplication | undefined;
  const failures: string[] = [];
  const launch = async () => {
    application = await electron.launch({ executablePath, args: [path.resolve(".")], env, timeout: 45000 });
    application.process().stderr?.on("data", chunk => {
      const value = String(chunk);
      if (value.includes("No such built-in module") || value.includes("Cannot find module")) failures.push(value);
    });
    const page = await application.firstWindow();
    page.on("pageerror", error => failures.push(error.message));
    await page.getByRole("heading", { name: "Tus casos, bajo control." }).waitFor();
    await page.waitForFunction(() => document.visibilityState === "visible");
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    return page;
  };
  try {
    let page = await launch();
    const today = dateKey(), openedAt = addDays(today, -10);
    const start = weekStart(today), closureDate = isWorkday(today) ? today : weekEnd(start);
    assert.equal(await page.locator(".weekbar strong").textContent(), weekLabel(start));
    assert.match(await page.locator(".app-footer").textContent() || "", /Lunes a viernes/);
    await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
    assert.equal(await page.locator(".weekbar strong").textContent(), weekLabel(addDays(start, -7)));
    await page.getByRole("button", { name: "Semana siguiente", exact: true }).click();
    assert.equal(await page.locator(".weekbar strong").textContent(), weekLabel(start));
    await count(page, "active-total", 0);
    assert.equal(await page.getByRole("button", { name: "Cerrar Caso", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Registrar caso", exact: true }).click();
    await page.getByLabel("ID del caso", { exact: true }).fill("TEST-001");
    await page.locator('input[name="title"]').fill("Conectividad de prueba");
    await page.getByLabel("Fecha de apertura", { exact: true }).fill(openedAt);
    await page.getByRole("dialog").getByRole("button", { name: "Registrar caso", exact: true }).click();
    await count(page, "active-total", 1);
    await count(page, "closed-total", 0);
    await age(page, "case-age", "10 d\u00edas abierto");
    await age(page, "focus-case-age", "10 d\u00edas abierto");
    await ageTone(page.getByTestId("case-age"), "warning");
    await ageTone(page.getByTestId("focus-case-age"), "warning");
    await ageColumn(page);
    if (process.env.CIERRES_SCREENSHOT_DIR) {
      await mkdir(process.env.CIERRES_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.CIERRES_SCREENSHOT_DIR, "cierres-active-test.png") });
    }
    await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
    await age(page, "case-age", "10 d\u00edas abierto");
    await page.getByRole("button", { name: "Ir a hoy", exact: true }).click();
    for (const [days, level] of [[0, "safe"], [1, "safe"], [5, "safe"], [6, "warning"], [13, "warning"], [14, "overdue"], [30, "overdue"], [10, "warning"]] as const) {
      const expected = `${days} ${days === 1 ? "d\u00eda" : "d\u00edas"} abierto`;
      await page.getByRole("button", { name: "Editar caso TEST-001", exact: true }).click();
      await page.getByLabel("Fecha de apertura", { exact: true }).fill(addDays(today, -days));
      await page.locator('select[name="status"]').selectOption("waiting");
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await age(page, "case-age", expected);
      await age(page, "focus-case-age", expected);
      await ageTone(page.getByTestId("case-age"), level);
      await ageTone(page.getByTestId("focus-case-age"), level);
      await page.getByRole("button", { name: "Cerrar Caso", exact: true }).click();
      await age(page, "close-case-age", `${expected} \u00b7 d\u00edas naturales`);
      await ageTone(page.getByTestId("close-case-age"), level);
      await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).last().click();
      if (days === 5 || days === 13) {
        await page.clock.setFixedTime(new Date(`${addDays(today, 1)}T12:00:00`));
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await age(page, "case-age", `${days + 1} d\u00edas abierto`);
        await ageTone(page.getByTestId("case-age"), days === 5 ? "warning" : "overdue");
        await ageTone(page.getByTestId("focus-case-age"), days === 5 ? "warning" : "overdue");
        await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await age(page, "case-age", expected);
        await ageTone(page.getByTestId("case-age"), level);
      }
    }
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 720));
    await page.waitForFunction(() => innerWidth <= 980);
    await ageColumn(page);
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 930));
    await page.waitForFunction(() => innerWidth > 1190);
    await page.clock.setFixedTime(new Date(`${addDays(today, 1)}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await age(page, "case-age", "11 d\u00edas abierto");
    await age(page, "focus-case-age", "11 d\u00edas abierto");
    await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await age(page, "case-age", "10 d\u00edas abierto");
    await page.getByRole("button", { name: "Cerrar Caso", exact: true }).click();
    await age(page, "close-case-age", "10 d\u00edas abierto \u00b7 d\u00edas naturales");
    await page.getByLabel("Fecha de cierre", { exact: true }).fill(addDays(start, -2));
    assert.equal(await page.getByRole("button", { name: "Confirmar cierre", exact: true }).isDisabled(), true);
    assert.match(await page.locator(".impact").textContent() || "", /lunes a viernes/);
    await page.getByLabel("Fecha de cierre", { exact: true }).fill(closureDate);
    assert.match(await page.locator(".impact").textContent() || "", /Al confirmar: 1 de 5 cierres/);
    await page.getByRole("button", { name: "Confirmar cierre", exact: true }).click();
    await count(page, "closed-total", 1);
    await count(page, "active-total", 0);
    await age(page, "case-age", `${daysBetween(openedAt, closureDate)} d\u00edas hasta el cierre`);
    await ageTone(page.getByTestId("case-age"), "warning");
    await page.clock.setFixedTime(new Date(`${addDays(today, 1)}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (weekStart(addDays(today, 1)) !== start)
      await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
    await age(page, "case-age", `${daysBetween(openedAt, closureDate)} d\u00edas hasta el cierre`);
    await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Editar caso TEST-001", exact: true }).click();
    await page.locator('input[name="title"]').fill("Conectividad verificada");
    const correctedOpening = addDays(today, -11), correctedClosure = start;
    await page.getByLabel("Fecha de apertura", { exact: true }).fill(correctedOpening);
    await page.locator('input[name="closedAt"]').fill(correctedClosure);
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.getByText("Conectividad verificada", { exact: true }).waitFor();
    const closedAge = `${daysBetween(correctedOpening, correctedClosure)} d\u00edas hasta el cierre`;
    await age(page, "case-age", closedAge);
    await ageTone(page.getByTestId("case-age"), daysBetween(correctedOpening, correctedClosure) <= 5 ? "safe" : "warning");
    await ageColumn(page);
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 720));
    await page.waitForFunction(() => innerWidth <= 980);
    await ageColumn(page);
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 930));
    await page.waitForFunction(() => innerWidth > 1190);
    if (process.env.CIERRES_SCREENSHOT_DIR) {
      await mkdir(process.env.CIERRES_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.CIERRES_SCREENSHOT_DIR, "cierres-app-test.png") });
    }
    const dataPath = await page.evaluate(async () => {
      const state = await window.cierres.state();
      return state.ok ? state.value.dataPath : "";
    });
    assert.equal(dataPath, path.join(folder, "tracking.sqlite"));
    await application!.close();
    application = undefined;
    page = await launch();
    await count(page, "closed-total", 1);
    await count(page, "active-total", 0);
    await page.getByRole("button", { name: /^Cerrados/ }).first().click();
    await page.getByText("Conectividad verificada", { exact: true }).waitFor();
    await age(page, "case-age", closedAge);
    await page.getByRole("button", { name: "Editar caso TEST-001", exact: true }).click();
    await page.getByRole("button", { name: "Reabrir caso", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar reapertura", exact: true }).click();
    await count(page, "active-total", 1);
    await count(page, "closed-total", 0);
    await page.getByRole("button", { name: /^Activos/ }).click();
    await age(page, "case-age", "11 d\u00edas abierto");
    await age(page, "focus-case-age", "11 d\u00edas abierto");
    await ageTone(page.getByTestId("case-age"), "warning");
    let activeCount = 1;
    for (const days of [5, 30, 0, 14, 6, 13]) {
      await page.getByRole("button", { name: "Registrar caso", exact: true }).click();
      await page.getByLabel("ID del caso", { exact: true }).fill(`AGE-${days}`);
      await page.locator('input[name="title"]').fill(`Prueba de plazo de ${days} dias`);
      await page.getByLabel("Fecha de apertura", { exact: true }).fill(addDays(today, -days));
      await page.getByRole("dialog").getByRole("button", { name: "Registrar caso", exact: true }).click();
      await count(page, "active-total", ++activeCount);
    }
    const expectedOrder = ["AGE-30", "AGE-14", "AGE-13", "TEST-001", "AGE-6", "AGE-5", "AGE-0"];
    assert.deepEqual(await page.locator("tbody .case-id").allTextContents(), expectedOrder);
    assert.equal(await page.getByRole("columnheader", { name: "D\u00cdAS ABIERTO", exact: true }).getAttribute("aria-sort"), "descending");
    for (const [number, level] of [["AGE-30", "overdue"], ["AGE-14", "overdue"], ["AGE-13", "warning"], ["AGE-6", "warning"], ["AGE-5", "safe"], ["AGE-0", "safe"]] as const) {
      const row = page.getByRole("row").filter({ has: page.getByText(number, { exact: true }) });
      await ageTone(row.getByTestId("case-age"), level);
    }
    await page.getByLabel("Buscar casos", { exact: true }).fill("AGE-");
    assert.deepEqual(await page.locator("tbody .case-id").allTextContents(), expectedOrder.filter(number => number.startsWith("AGE-")));
    await page.getByLabel("Buscar casos", { exact: true }).fill("");
    await page.getByRole("button", { name: "Seleccionar caso AGE-14", exact: true }).click();
    await age(page, "focus-case-age", "14 d\u00edas abierto");
    await ageTone(page.getByTestId("focus-case-age"), "overdue");
    if (process.env.CIERRES_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.CIERRES_SCREENSHOT_DIR, "cierres-deadlines-test.png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Cerrar Caso", exact: true }).click();
    const options = await page.getByRole("dialog").getByRole("combobox").locator("option").allTextContents();
    assert.deepEqual(options.slice(1).map(option => option.split(" - ")[0]), expectedOrder);
    await ageTone(page.getByTestId("close-case-age"), "overdue");
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await page.getByRole("button", { name: "Editar caso AGE-0", exact: true }).click();
    await page.getByLabel("Fecha de apertura", { exact: true }).fill(addDays(today, -40));
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await age(page, "case-age", "40 d\u00edas abierto");
    assert.deepEqual(await page.locator("tbody .case-id").allTextContents(), ["AGE-0", ...expectedOrder.slice(0, -1)]);
    await ageTone(page.getByTestId("case-age").first(), "overdue");
    await page.getByRole("button", { name: "Cerrar Caso", exact: true }).click();
    await page.getByLabel("Fecha de cierre", { exact: true }).fill(closureDate);
    await page.getByRole("button", { name: "Confirmar cierre", exact: true }).click();
    await count(page, "active-total", 6);
    await count(page, "closed-total", 1);
    const overdueClosedAge = `${daysBetween(addDays(today, -40), closureDate)} d\u00edas hasta el cierre`;
    await age(page, "case-age", overdueClosedAge);
    await ageTone(page.getByTestId("case-age"), "overdue");
    await page.clock.setFixedTime(new Date(`${addDays(today, 1)}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (weekStart(addDays(today, 1)) !== start)
      await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
    await age(page, "case-age", overdueClosedAge);
    await ageTone(page.getByTestId("case-age"), "overdue");
    await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Editar caso AGE-0", exact: true }).click();
    await page.getByRole("button", { name: "Reabrir caso", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar reapertura", exact: true }).click();
    await count(page, "active-total", 7);
    await page.getByRole("button", { name: /^Activos/ }).click();
    await age(page, "case-age", "40 d\u00edas abierto");
    await page.getByRole("button", { name: "Seleccionar caso AGE-5", exact: true }).click();
    await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
    await age(page, "focus-case-age", "5 d\u00edas abierto");
    assert.equal(await page.locator("tbody .case-id").first().textContent(), "AGE-0");
    await page.reload();
    await count(page, "active-total", 7);
    await age(page, "case-age", "40 d\u00edas abierto");
    await age(page, "focus-case-age", "40 d\u00edas abierto");
    await ageTone(page.getByTestId("focus-case-age"), "overdue");
    assert.deepEqual(await page.locator("tbody .case-id").allTextContents(), ["AGE-0", ...expectedOrder.slice(0, -1)]);
    assert.deepEqual(failures, []);
    assert.equal(await page.evaluate(() => typeof (window as Window & { require?: unknown }).require), "undefined");
  } finally {
    if (application) await application.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
