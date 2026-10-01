import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveDataFolder } from "../electron/data-path";

const appData = path.resolve("test-roaming");
const portable = path.resolve("test-portable");
const isolated = path.resolve("test-isolated");

test("installed and development builds retain the existing data directory", () => {
  assert.equal(resolveDataFolder(appData, true, {}), path.join(appData, "Cierres"));
  assert.equal(resolveDataFolder(appData, false, {}), path.join(appData, "Cierres"));
  assert.equal(resolveDataFolder(appData, false, { PORTABLE_EXECUTABLE_DIR: portable }), path.join(appData, "Cierres"));
});

test("packaged portable stores data next to its launcher, not in AppData or the extraction folder", () => {
  assert.equal(resolveDataFolder(appData, true, { PORTABLE_EXECUTABLE_DIR: portable }), path.join(portable, "Cierres-data"));
  assert.throws(() => resolveDataFolder(appData, true, { PORTABLE_EXECUTABLE_DIR: "relative" }), /absoluta/);
});

test("test mode is isolated and can never silently fall back to production data", () => {
  const env = { CIERRES_TEST_MODE: "1", CIERRES_DATA_DIR: isolated, PORTABLE_EXECUTABLE_DIR: portable };
  assert.equal(resolveDataFolder(appData, false, env), isolated);
  assert.equal(resolveDataFolder(appData, true, env), path.join(portable, "Cierres-data"));
  assert.equal(resolveDataFolder(appData, true, { CIERRES_TEST_MODE: "1", CIERRES_DATA_DIR: isolated }), path.join(appData, "Cierres"));
  assert.throws(() => resolveDataFolder(appData, false, { CIERRES_TEST_MODE: "1" }), /CIERRES_DATA_DIR/);
  assert.throws(() => resolveDataFolder(appData, false, { CIERRES_TEST_MODE: "1", CIERRES_DATA_DIR: "relative" }), /absoluta/);
});
