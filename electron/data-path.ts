import path from "node:path";

export function resolveDataFolder(
  appData: string, isPackaged: boolean, env: NodeJS.ProcessEnv
): string {
  if (!isPackaged && env.CIERRES_TEST_MODE === "1") {
    if (!env.CIERRES_DATA_DIR || !path.isAbsolute(env.CIERRES_DATA_DIR))
      throw new Error("El modo de pruebas requiere CIERRES_DATA_DIR con una ruta absoluta.");
    return path.resolve(env.CIERRES_DATA_DIR);
  }
  if (isPackaged && env.PORTABLE_EXECUTABLE_DIR) {
    if (!path.isAbsolute(env.PORTABLE_EXECUTABLE_DIR))
      throw new Error("La carpeta de la version portable debe ser una ruta absoluta.");
    return path.join(env.PORTABLE_EXECUTABLE_DIR, "Cierres-data");
  }
  return path.join(appData, "Cierres");
}
