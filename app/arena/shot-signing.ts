import { CLIENT_BUILD, CLIENT_FLAGS, reportMessage, type AimTrail, type ShotProof } from "@/lib/anti-cheat-rules";

// Signs a shot report with the run's shot key, so a report edited on its way to
// the server no longer verifies (lib/shot-key.ts checks it).

const isNative = (fn: unknown) => typeof fn === "function" && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));

/** Page functions the game relies on that something replaced. */
export function clientFlags() {
  let flags = 0;
  if (!isNative(window.fetch)) flags |= CLIENT_FLAGS.fetchPatched;
  if (!isNative(EventTarget.prototype.dispatchEvent)) flags |= CLIENT_FLAGS.dispatchPatched;
  return flags;
}

/** The shot-log key of a run: tournament runs are addressed as `t:<entry id>`. */
export const runKeyOf = (runId: string) => (runId.startsWith("t:") ? `t-${runId.slice(2)}` : `m-${runId}`);

export type UnsignedProof = Omit<ShotProof, "sig" | "v" | "build">;

export async function signProof(key: string, runId: string, revision: number, angle: number, proof: UnsignedProof, aim: AimTrail): Promise<ShotProof> {
  const full = { ...proof, build: CLIENT_BUILD };
  const message = reportMessage({ runKey: runKeyOf(runId), revision, angle, proof: full, aim });
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, encoder.encode(message)));
  return { v: 2, ...full, sig: Array.from(signature, (b) => b.toString(16).padStart(2, "0")).join("") };
}
