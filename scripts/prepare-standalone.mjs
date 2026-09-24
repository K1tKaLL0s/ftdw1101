import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve(".next/static");
const destination = resolve(".next/standalone/.next/static");
if (!existsSync(source)) {
  console.error("Run npm run build before starting the standalone server.");
  process.exit(1);
}
mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true, force: true });

const publicSource = resolve("public");
const publicDestination = resolve(".next/standalone/public");
if (existsSync(publicSource)) {
  mkdirSync(dirname(publicDestination), { recursive: true });
  cpSync(publicSource, publicDestination, { recursive: true, force: true });
}
