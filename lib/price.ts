import { database } from "@/db/raw";

// What a SOL is worth, in money people think in.
//
// The game is played in devnet SOL, which is worth nothing — but the amounts on
// screen mean something to a player only if they can read them in euros or
// dollars, so the rate quoted here is the real one for mainnet SOL. It is only
// ever a display: nothing on the site is priced, settled or paid from it.
//
// The rate is fetched on the server and kept in `app_settings`, so a page never
// talks to a price API itself (the content policy would refuse it anyway), and
// every visitor shares one lookup rather than making their own.

const KEY = "sol_price";
/** How stale a rate may be before the next request refreshes it. */
const TTL = 10 * 60_000;
/** A rate older than this is not shown at all: better no figure than a wrong one. */
const STALE = 24 * 60 * 60_000;
const SOURCE = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd,eur";

export type Currency = "usd" | "eur";
export type Price = { usd: number; eur: number; at: number };

/** In-process, so a burst of requests on one instance makes one lookup. */
let cached: Price | null = null;
let fetching: Promise<Price | null> | null = null;

const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000;

async function read(): Promise<Price | null> {
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<Price>;
    if (valid(parsed.usd) && valid(parsed.eur) && typeof parsed.at === "number") return { usd: parsed.usd, eur: parsed.eur, at: parsed.at };
  } catch {
    // A malformed row is treated as no rate at all.
  }
  return null;
}

async function store(price: Price) {
  await database()
    .prepare(
      "INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, 'price', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
    )
    .bind(KEY, JSON.stringify(price), price.at)
    .run();
}

/** One lookup, with the stored rate kept if the source is unreachable. */
async function refresh(now: number): Promise<Price | null> {
  try {
    const response = await fetch(SOURCE, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000), cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { solana?: { usd?: unknown; eur?: unknown } };
    const usd = body.solana?.usd;
    const eur = body.solana?.eur;
    if (!valid(usd) || !valid(eur)) return null;
    const price: Price = { usd, eur, at: now };
    await store(price);
    cached = price;
    return price;
  } catch {
    // Offline, rate-limited, or a shape we do not recognise: keep what we have.
    return null;
  }
}

/**
 * The current rate, or null while none has ever been fetched. A stale rate is
 * served immediately and refreshed behind the request, so no page waits on a
 * price API.
 */
export async function solPrice(now = Date.now()): Promise<Price | null> {
  const known = cached ?? (await read());
  if (known) cached = known;
  if (known && now - known.at < TTL) return known;
  // One refresh at a time per instance.
  fetching ??= refresh(now).finally(() => {
    fetching = null;
  });
  if (known) {
    void fetching;
    return now - known.at < STALE ? known : null;
  }
  const fresh = await fetching;
  return fresh;
}

/** Tests: forget what this instance has read. */
export const forgetPrice = () => void (cached = null);
