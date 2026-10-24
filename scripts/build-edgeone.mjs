import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const nextCli = resolve("node_modules/next/dist/bin/next");
// EdgeOne's middleware loader cannot unpack Next 16.4 Turbopack's compressed module factories.
const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
  stdio: "inherit",
  env: { ...process.env, EDGEONE_BUILD: "1" },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
