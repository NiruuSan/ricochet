import type { Asset, Snapshot } from "@/lib/api-types";

export type PlayerData = Pick<Snapshot, "matches" | "active"> &
  Partial<
    Pick<Snapshot, "cashBalance" | "launch" | "player" | "isAdmin" | "notifications" | "unreadNotifications" | "tournaments" | "suspension" | "daily" | "friends" | "discountUntil" | "questsReady" | "theme" | "rewardsReady" | "survey">
  > & { authenticated?: boolean };

export const EMPTY_PLAYER: PlayerData = { matches: [], active: null };

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) { super(message); }
}

/**
 * Asked when an administrator request comes back needing a fresh second-factor
 * code — a change after its 15 minutes, or the admin itself after its 12 hours
 * or on a new network. It resolves true once the code opened the window, and
 * the request is sent again: the page that made it never has to know.
 */
let confirmAdmin: (() => Promise<boolean>) | null = null;
export function onAdminConfirmation(handler: () => Promise<boolean>) {
  confirmAdmin = handler;
  return () => {
    if (confirmAdmin === handler) confirmAdmin = null;
  };
}

/** The prompt on screen, which every request that needs a code meanwhile waits for. */
let confirming: Promise<boolean> | null = null;
/** When the prompt was last turned down: the admin's own polling does not raise it again straight away. */
let declinedAt = 0;
const ADMIN_CODES = new Set(["ADMIN_ELEVATION_REQUIRED", "ADMIN_VIEW_REQUIRED"]);

function askForCode(read: boolean) {
  if (!confirmAdmin) return Promise.resolve(false);
  if (read && !confirming && Date.now() - declinedAt < 120_000) return Promise.resolve(false);
  confirming ??= confirmAdmin()
    .then((ok) => {
      if (!ok) declinedAt = Date.now();
      return ok;
    })
    .finally(() => {
      confirming = null;
    });
  return confirming;
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
  if (response.status === 403 && ADMIN_CODES.has(data?.code ?? "") && !retried && (await askForCode(!body))) {
    return request<T>(path, body, true);
  }
  if (!response.ok || !data) throw new RequestError(data?.error || "Something went wrong. Please try again.", response.status, data?.code, data ?? undefined);
  return data;
}

export const loadPlayer = (asset: Asset) => request<PlayerData>(`/api/game?asset=${asset}`);

export const gameAction = <T>(body: Record<string, unknown>) => request<T>("/api/game", body);
