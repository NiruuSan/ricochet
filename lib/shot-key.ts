import { createHmac, timingSafeEqual } from "node:crypto";

// Shot keys: each run gets a key the client signs its shot reports with, so a
// report edited on its way to the server (a script rewriting the request) no
// longer matches. The key is derived from a server secret and the run, and
// reaches only the run's player.

export function serverSecret() {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required to sign shot reports.");
  return "development-shot-key-secret";
}

/** `runKey` is the shot-log key: `m-<run id>` or `t-<entry id>`. */
export const shotKeyFor = (runKey: string) => createHmac("sha256", serverSecret()).update(`bounce-shot-key:${runKey}`).digest("hex");

export const signReport = (key: string, message: string) => createHmac("sha256", key).update(message).digest("hex");

export function validSignature(runKey: string, message: string, signature: string) {
  const expected = Buffer.from(signReport(shotKeyFor(runKey), message), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
