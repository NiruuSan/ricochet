import { createHmac, randomBytes } from "node:crypto";
import type { RowSource } from "./engine";

// Server-only row generation for ruleset 6. Each match and tournament has its own
// random key, stored in the database and never sent to a browser. Rows are an
// HMAC of the key and the round, so every player on the same match or tournament
// gets exactly the same rows, and nobody can compute a row before the server
// reveals it.

/** A fresh 256-bit row key, as hex. */
export const newRowKey = () => randomBytes(32).toString("hex");

export function secretRows(key: string): RowSource {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid row key.");
  const secret = Buffer.from(key, "hex");
  return (round) => {
    const bytes = createHmac("sha256", secret).update(`ricochet:row:${round}`).digest();
    const cols = [0, 1, 2, 3, 4, 5, 6];
    // Fisher-Yates driven by two bytes per swap; the modulo bias is below 0.01%.
    for (let i = 6; i > 0; i--) {
      const j = bytes.readUInt16BE(2 * i) % (i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    return cols.slice(0, 1 + (bytes[0] % 7));
  };
}

/** The row source for a stored board: secret rows from ruleset 6, the seed before. */
export function rowsFor(ruleset: number, rowKey: string | null | undefined) {
  if (ruleset < 6) return undefined;
  // Without its key a ruleset 6 board would silently stop growing rows.
  if (!rowKey) throw new Error("This board is missing its row key.");
  return secretRows(rowKey);
}
