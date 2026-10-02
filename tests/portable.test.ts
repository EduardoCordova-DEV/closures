import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo reservar un puerto local.");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test("portable EXE starts empty and keeps its cases and To Do when moved to another folder", { timeout: 240000 }, async () => {
  const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const source = path.resolve("release", `Cierres-Portable-${version}-x64.exe`);
  assert.ok((await stat(source)).size > 0, "Run npm run package:release first.");
  const original = await mkdtemp(path.join(tmpdir(), "cierres portable test-"));
  const moved = `${original}-moved`;
  let folder = original;
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  const failures: string[] = [];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ![
      "ELECTRON_RUN_AS_NODE", "CIERRES_TEST_MODE", "CIERRES_DATA_DIR",
      "PORTABLE_EXECUTABLE_DIR", "PORTABLE_EXECUTABLE_FILE", "PORTABLE_EXECUTABLE_APP_FILENAME"
    ].includes(key)) env[key] = value;
  }
  const close = async () => {
    if (child?.pid && child.exitCode === null) {
      const page = browser?.contexts()[0]?.pages()[0];
      if (!page) throw new Error("Portable test window not found.");
      await page.evaluate(() => { void window.cierres.quit(); });
      if (child.exitCode === null) await once(child, "exit", { signal: AbortSignal.timeout(15000) });
    }
    child = undefined;
    if (browser) await browser.close();
    browser = undefined;
  };
  const launch = async () => {
    const port = await availablePort();
    let launchError: Error | undefined;
    child = spawn(path.join(folder, "Cierres-Portable.exe"), [
      `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"
    ], { env, stdio: "ignore" });
    child.on("error", error => { launchError = error; });
    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Portable exited before opening: ${child.exitCode}`);
      try {
        const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (!response.ok) throw new Error(`Debugger returned HTTP ${response.status}`);
        ready = true;
        break;
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        if (!(cause instanceof Error && "code" in cause && cause.code === "ECONNREFUSED") &&
          !(error instanceof Error && error.name === "TimeoutError")) throw error;
        await delay(250);
      }
    }
    if (!ready) throw new Error("Portable did not expose its local test debugger within 90 seconds.");
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent("page");
    page.on("pageerror", error => failures.push(error.message));
    await page.waitForFunction(() => typeof window.cierres?.state === "function");
    await page.getByRole("heading", { name: "Tus casos, bajo control." }).waitFor();
    const state = await page.evaluate(() => window.cierres.state());
    if (!state.ok) throw new Error(state.error);
    assert.equal(state.value.dataPath, path.join(folder, "Cierres-data", "tracking.sqlite"));
    assert.equal(state.value.backupPath, path.join(folder, "Cierres-data", "backups"));
    return { page, state: state.value };
  };
  try {
    await copyFile(source, path.join(original, "Cierres-Portable.exe"));
    const first = await launch();
    assert.equal(first.state.cases.length, 0);
    assert.equal(first.state.todos.length, 0);
    await first.page.getByRole("button", { name: "Registrar caso", exact: true }).click();
    await first.page.getByLabel("ID del caso", { exact: true }).fill("PORTABLE-TEST-ONLY");
    await first.page.locator('input[name="title"]').fill("Datos sinteticos para validar portabilidad");
    await first.page.getByRole("dialog").getByRole("button", { name: "Registrar caso", exact: true }).click();
    await first.page.waitForFunction(() => document.querySelector('[data-testid="active-total"]')?.textContent === "1");
    const nativeNotifications = process.env.CIERRES_TEST_NATIVE_NOTIFICATIONS === "1";
    const created = await first.page.evaluate(async native => {
      const state = await window.cierres.state();
      if (!state.ok) throw new Error(state.error);
      return window.cierres.createTodo({
        title: "Cierres: prueba local de recordatorio",
        notes: "Datos sinteticos, no es un caso real.", dueDate: null,
        caseId: state.value.cases[0].id,
        reminderAt: native ? new Date(Date.now() - 60000).toISOString() : null
      });
    }, nativeNotifications);
    if (!created.ok) throw new Error(created.error);
    if (nativeNotifications) {
      const deadline = Date.now() + 45000;
      let delivered = false;
      while (Date.now() < deadline) {
        const result = await first.page.evaluate(() => window.cierres.state());
        if (!result.ok) throw new Error(result.error);
        assert.equal(result.value.reminderError, "");
        delivered = result.value.todos.some(item => Boolean(item.reminderNotifiedAt));
        if (delivered) break;
        await delay(250);
      }
      assert.ok(delivered, "Windows must acknowledge the real packaged notification.");
    }
    await close();
    await cp(original, moved, { recursive: true, force: false, errorOnExist: true });
    folder = moved;
    const second = await launch();
    assert.equal(second.state.cases.length, 1);
    assert.equal(second.state.cases[0].number, "PORTABLE-TEST-ONLY");
    assert.equal(second.state.todos.length, 1);
    assert.equal(second.state.todos[0].caseId, second.state.cases[0].id);
    if (nativeNotifications) assert.ok(second.state.todos[0].reminderNotifiedAt);
    await second.page.getByText("PORTABLE-TEST-ONLY", { exact: true }).first().waitFor();
    assert.deepEqual(failures, []);
  } catch (error) {
    console.error("Portable test failed:", error);
    throw error;
  } finally {
    try { await close(); }
    finally {
      if (child?.pid && child.exitCode === null) {
        execFileSync("powershell", ["-NoProfile", "-Command", `
          $ErrorActionPreference = 'Stop'
          $all = @(Get-CimInstance Win32_Process)
          function Stop-TestTree([int]$processId) {
            foreach ($descendant in ($all | Where-Object { $_.ParentProcessId -eq $processId })) {
              Stop-TestTree $descendant.ProcessId
            }
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process) {
              try { Stop-Process -Id $processId -Force }
              catch { if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw } }
            }
          }
          Stop-TestTree ${child.pid}
        `], { stdio: "pipe" });
      }
      await rm(original, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      await rm(moved, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  }
});
