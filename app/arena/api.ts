import type { Asset, Snapshot } from "@/lib/api-types";

export type PlayerData = Pick<Snapshot, "matches" | "transactions" | "leaders" | "active"> &
  Partial<Pick<Snapshot, "cashBalance" | "launch" | "player" | "isAdmin">> & { authenticated?: boolean };

export const EMPTY_PLAYER: PlayerData = { matches: [], transactions: [], leaders: [], active: null };

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" },
  );
  let data: (T & { error?: string }) | null = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON responses (for example a gateway error page) fall through below.
  }
  if (!response.ok || !data) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data;
}

export const loadPlayer = (asset: Asset) => request<PlayerData>(`/api/game?asset=${asset}`);

export const gameAction = <T>(body: Record<string, unknown>) => request<T>("/api/game", body);
