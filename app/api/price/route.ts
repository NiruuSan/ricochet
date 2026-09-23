import { solPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

/**
 * What a SOL is worth today, for the pages that show amounts in euros or
 * dollars beside them. Public and cacheable: it is the same number for
 * everybody, and it decides nothing — no balance, stake or payout is computed
 * from it.
 */
export async function GET() {
  try {
    const price = await solPrice();
    return Response.json(price ?? { usd: null, eur: null, at: null }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    console.error(e);
    return Response.json({ usd: null, eur: null, at: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
