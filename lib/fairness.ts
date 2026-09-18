import { createHash } from "node:crypto";

// Provably fair boards. Every ruleset 6 match and tournament draws its rows from
// a secret key (lib/secret-rows.ts). The key stays on the server while anyone
// can still play the board, but its fingerprint is published from the first
// shot: once the game is over the key is revealed, and anyone can check that the
// rows they were given are the ones that key produces, and that the key is the
// one that was committed to before the first shot.

export type Fairness = {
  /** SHA-256 of the row key, published from the start. */
  hash: string;
  /** The key itself, once nobody can play this board any more. */
  key: string | null;
};

export const rowCommitment = (rowKey: string) => createHash("sha256").update(rowKey).digest("hex");

/** The commitment for a board, and the key once `revealed`. Null before ruleset 6. */
export function fairnessFor(rowKey: string | null | undefined, revealed: boolean): Fairness | null {
  if (!rowKey) return null;
  return { hash: rowCommitment(rowKey), key: revealed ? rowKey : null };
}
