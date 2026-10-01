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

test("portable EXE starts empty and keeps its cases when moved to another folder", { timeout: 240000 }, async () => {
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
      execFileSync("powershell", ["-NoProfile", "-Command", `
        $ErrorActionPreference = 'Stop'
        $closed = $false
        Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid}" | ForEach-Object {
          $process = Get-Process -Id $_.ProcessId
          if ($process.MainWindowHandle -ne 0) {
            if (-not $process.CloseMainWindow()) { throw 'Could not close the portable test window.' }
            $closed = $true
          }
        }
        if (-not $closed) { throw 'Portable test window not found.' }
      `], { stdio: "pipe" });
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
    await first.page.getByRole("button", { name: "Registrar caso", exact: true }).click();
    await first.page.getByLabel("ID del caso", { exact: true }).fill("PORTABLE-TEST-ONLY");
    await first.page.locator('input[name="title"]').fill("Datos sinteticos para validar portabilidad");
    await first.page.getByRole("dialog").getByRole("button", { name: "Registrar caso", exact: true }).click();
    await first.page.waitForFunction(() => document.querySelector('[data-testid="active-total"]')?.textContent === "1");
    await close();
    await cp(original, moved, { recursive: true, force: false, errorOnExist: true });
    folder = moved;
    const second = await launch();
    assert.equal(second.state.cases.length, 1);
    assert.equal(second.state.cases[0].number, "PORTABLE-TEST-ONLY");
    await second.page.getByText("PORTABLE-TEST-ONLY", { exact: true }).first().waitFor();
    assert.deepEqual(failures, []);
  } finally {
    try { await close(); }
    finally {
      if (child?.pid && child.exitCode === null) {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "pipe" });
      }
      await rm(original, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      await rm(moved, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  }
});
