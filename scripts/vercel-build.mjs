import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function runNode(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed; stopping deployment.`);
}

/** Production must update its schema before publishing code that requires it. */
export function vercelBuild(env = process.env, run = runNode) {
  if (env.VERCEL_ENV === "production") {
    if (!env.TURSO_DATABASE_URL) throw new Error("Production deployment requires TURSO_DATABASE_URL for database migrations.");
    run(fileURLToPath(new URL("./migrate.mjs", import.meta.url)), [], env);
  }
  // Preview deployments must not change a potentially shared production database.
  run(fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), ["build", "--webpack"], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { vercelBuild(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
