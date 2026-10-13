import type { Asset, Snapshot } from "@/lib/api-types";

export type PlayerData = Pick<Snapshot, "matches" | "active"> &
  Partial<
    Pick<Snapshot, "cashBalance" | "launch" | "player" | "isAdmin" | "notifications" | "unreadNotifications" | "tournaments" | "suspension" | "daily" | "friends" | "discountUntil" | "questsReady" | "theme" | "rewardsReady">
  > & { authenticated?: boolean };

export const EMPTY_PLAYER: PlayerData = { matches: [], active: null };

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) { super(message); }
}

/**
 * Asked when an administrator change comes back needing a fresh second-factor
 * code. It resolves true once the code opened the window, and the request is
 * sent again — the page that made it never has to know.
 */
let confirmAdmin: (() => Promise<boolean>) | null = null;
export function onAdminConfirmation(handler: () => Promise<boolean>) {
  confirmAdmin = handler;
  return () => {
    if (confirmAdmin === handler) confirmAdmin = null;
  };
}

export async function request<T>(path: string, body?: unknown, retried = false): Promise<T> {
  const response = await fetch(
    path,
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" },
  );
  let data: (T & { error?: string; code?: string }) | null = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON responses (for example a gateway error page) fall through below.
  }
  if (response.status === 403 && data?.code === "ADMIN_ELEVATION_REQUIRED" && confirmAdmin && !retried && (await confirmAdmin())) {
    return request<T>(path, body, true);
  }
  if (!response.ok || !data) throw new RequestError(data?.error || "Something went wrong. Please try again.", response.status, data?.code, data ?? undefined);
  return data;
}

export const loadPlayer = (asset: Asset) => request<PlayerData>(`/api/game?asset=${asset}`);

export const gameAction = <T>(body: Record<string, unknown>) => request<T>("/api/game", body);
