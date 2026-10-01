import { build } from "esbuild";
import "./make-icon.mjs";
await build({
  entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
  outdir: "dist-electron", outExtension: { ".js": ".cjs" },
  bundle: true, platform: "node", target: "node24", format: "cjs",
  external: ["electron", "node:*"], sourcemap: false
});
