import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const names = [`Cierres-Setup-${version}-x64.exe`, `Cierres-Portable-${version}-x64.exe`];
const sums = [];
for (const name of names) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join("release", name))) hash.update(chunk);
  sums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(path.join("release", "SHA256SUMS.txt"), `${sums.join("\n")}\n`, "utf8");
console.log("Ejecutables y SHA256SUMS.txt listos en release.");
