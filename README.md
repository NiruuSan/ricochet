# Ricochet

Playable private prototype of the requested asynchronous 1v1 brick-breaker. This development version supports free gems (the in-game currency) and separately accounted Solana devnet payments. **Mainnet is disabled in code; this is not a real-money launch.** Gem amounts are whole gems; SOL amounts use integer lamports (1 SOL = 1,000,000,000 units).

Stack: Next.js 16 on Vercel, Turso (libSQL) database, Auth.js with GitHub sign-in.

## Implemented

- Landing page, arena, saved matches, settled P&L leaderboard, login, balances/activity, rules/Q&A.
- Player profile at `/profile`: change the player name (unique regardless of case) and upload a profile picture. Pictures are cropped and resized to 256 px in the browser, checked by their bytes on the server (JPEG, PNG or WebP, at most 100 kB), and served from `/api/avatars/<random key>`, so a picture URL never reveals a player ID.
- Admin dashboard at `/admin`: registered, online (active in the last minute) and offline players; rolling 24-hour, 7-day and 30-day volumes (SOL staked, matches, deposits, withdrawals, house fees, and the gem equivalents); and the live devnet treasury (house balance, player balances owed, escrow, on-chain pool balance) with treasury deposit and withdrawal.
- GitHub sign-in (Auth.js, stateless JWT sessions) with server-side authorization. A player's ID is `github:<numeric GitHub user ID>`, which never changes with their username. Player profile creation grants 2,000 gems once.
- Deterministic 472×612, 7×9 board; per-round seeded brick generation, sequential multi-ball flight, per-hit scores, descending rows, extra balls and clear-board bonus.
- Persistent asynchronous matchmaking at the five requested entry levels. Both players can play concurrently. Saved shots support resuming across sessions. Opponent scores hidden until settlement.
- Each shot is simulated server-side; the client never submits an authoritative score. Optimistic revisions reject duplicate or stale shots.
- Every match records the engine ruleset it was created under and is always simulated with it, so a deploy never changes the rules of a match in progress. Ruleset 3 (current) uses portable trigonometry so every browser replays the server's result bit for bit, and caps the work a single shot may cost (about half a second of CPU). Ruleset 2 matches still replay exactly as before, checked against recorded replays.
- Snapshots only settle matches that are still unsettled, and never return other players' user IDs.
- Per-user, per-minute request limits on the game, wallet and treasury APIs.
- Atomic match entry and ledger balance updates, database-enforced nonnegative balances and one active run per player, idempotent settlement.
- Separate gem/devnet match queues, entry amounts (25–1,000 gems or 0.05–10 SOL), balances, match history and P&L rankings. Funded entries move into a match escrow account; settlement transfers the pot to the winner and the house. Gems cannot become devnet credit.
- Per-player Solana deposit addresses, encrypted server-side with AES-GCM and owner/network-bound authenticated data. Wallet provisioning occurs on signup when configured, with retry on wallet access.
- Devnet deposit sweeps into pooled custody, credited only after finalized success. Withdrawals reserve principal and network fee atomically with a durable, signed transaction outbox. Duplicate operation IDs cannot create a second payment; retries use the same signed bytes.
- Treasury balance and transfer controls at `/admin`, authorized only by `RICOCHET_ADMIN_USER_ID`. This control can withdraw earned house fees only. It cannot spend player ledger balances or reserved match pots. Administrators see every open transfer and can recheck one or all of them.
- Finalized on-chain failures refund withdrawal principal once, retaining the network fee. A transaction is only treated as never sent once the finalized chain is 150 blocks past its blockhash expiry and the RPC's transaction history has no record of it; principal and fee then return once. Until then the reserve stays held. An elapsed timer alone is never proof of non-payment.

## Rules decisions

Ground is the bottom row, followed by 1–7, then sky. Bricks spawn at row 7 and have HP equal to the new round. A row-1 brick ends the run on descent. All balls must return to finish a round; the first return sets the next launch position. Each round adds one ball, and a full clear adds four more. Aim angles range from 8° to 172° to prevent horizontal non-returning shots. A fixed 120 Hz simulation is shared by server and client.

The winner receives 1.76× their own stake. The house receives 0.24× one stake, equal to 12% of both entries. Ties refund both entries fully with no fee. One forfeit loses to a completed opponent; if both forfeit, scores decide. A creator who forfeits before anyone joins cancels the match: the seat can no longer be taken (which would hand a stranger a free win) and the entry is refunded minus the 12% fee (so forfeiting is not a free way to shop for seeds). Open matches do not expire and reserved entries are not withdrawable in this development version. Decide production expiry/refund rules before accepting funds.

## Development payment setup

Payments default to disabled, and no RPC credential or wallet encryption key is included. Configure these server-only runtime values for a private devnet test:

- `SOLANA_NETWORK=devnet`
- `SOLANA_RPC_URL`: an HTTPS endpoint for Solana devnet. The service verifies the returned genesis hash before signing/submitting financial transactions. Use a trusted RPC provider.
- `SOLANA_VAULT_KEY`: a securely generated, base64-encoded 32-byte encryption key. Back it up securely before provisioning wallets; replacing or losing it makes existing encrypted wallet keys unreadable. Key rotation is not implemented.
- `RICOCHET_ADMIN_USER_ID`: the intended administrator’s player ID, `github:<numeric GitHub user ID>` (find the number at `https://api.github.com/users/<username>`).

Apply all committed migrations with `pnpm db:migrate` (see Deploying). Never edit a migration after it has been applied. The second migration adds cash accounting, encrypted wallets, the payment outbox and a guard that aborts overdrafts even during idempotent settlement. The third adds the per-match ruleset (existing matches default to ruleset 2), match cancellation and rate-limit counters. There is no runtime schema creation.

Send **devnet test SOL only** to the displayed deposit address, then select Check deposit. Recheck a pending transfer to submit the same signed transaction or retrieve its finalized status. The deposit sweep fee is deducted before crediting the player. Withdrawals show the complete destination for confirmation, then calculate a network fee capped at 0.001 devnet SOL. Program addresses and internal Ricochet addresses are rejected as withdrawal destinations.

This release uses one player custody pool, with at most one open outgoing transaction per source address. This intentionally serializes pool withdrawals. So that one abandoned transfer cannot block everyone, starting a transfer first reconciles whatever is still open on the same source address, whoever started it. Transfers are driven by open wallet pages: they detect SOL arriving at a deposit address, sweep it into the pool, and recheck open transfers every few seconds until they settle. Nothing runs while no wallet or admin page is open (a Vercel Cron calling the admin sweep would be the natural next step), and there is no throughput scaling. The public `https://api.devnet.solana.com` endpoint rate-limits shared cloud IPs; prefer a free devnet endpoint from an RPC provider. The expiry decision trusts the configured RPC's transaction history, which is another reason to use a trusted provider. Never delete a transfer record or reuse its operation ID.

`SOLANA_NETWORK=mainnet` does not enable anything. The real-money launch gate is independent of client input and environment flags. The country restriction list is intentionally unset pending the owner’s launch policy; this build does not claim to geoblock countries or validate a licence.

## Production work still required

This is not a production real-money service. Production still needs the operator’s completed launch review and licence, server-side location enforcement using the final country policy, public account identity and recovery, eligibility checks, independently reviewed custody and key management, background payment monitoring/reconciliation, withdrawal abuse controls beyond basic per-minute limits, audited operational access, anti-automation and seed/shot-exploration abuse controls, an abandoned-match policy, and security/load testing. These are outstanding work, not features enabled by changing an environment flag.

Server validation blocks direct score forgery but does not stop a client from trying angles locally against a known seed. A paid competition needs a considered competition-integrity policy and stronger controls. Practice sessions are transient. Match history and activity currently show the last 50 records. Anyone with a GitHub account can sign in and play gem matches.

## Deploying to Vercel

1. **Database.** Create a Turso database (`turso db create ricochet`), then read its URL (`turso db show ricochet --url`) and create a token (`turso db tokens create ricochet`).
2. **Schema.** From your machine: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate`. It applies each pending file in `drizzle/` in its own transaction and records it in `_ricochet_migrations`, so it is safe to rerun. Run it before deploying code that needs a new migration.
3. **GitHub OAuth App.** GitHub → Settings → Developer settings → OAuth Apps → New. Homepage: your Vercel URL. Authorization callback URL: `https://<your-domain>/api/auth/callback/github`. A GitHub OAuth App allows one callback URL, so create a second app for local development (`http://localhost:3000/api/auth/callback/github`).
4. **Environment variables** (Vercel → Project → Settings → Environment Variables, see `.env.example`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET` (`npx auth secret`), `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and optionally `RICOCHET_ADMIN_USER_ID` and the Solana settings above.
5. **Deploy.** Vercel detects Next.js; the default build (`pnpm run build` → `next build --webpack`) needs no extra settings. Keep webpack: see `next.config.ts`. Redeploy after changing environment variables.

## Development

`pnpm dev` runs Next.js locally. Put local settings in `.env.local`: `TURSO_DATABASE_URL=file:local.db` works without an account (run `TURSO_DATABASE_URL=file:local.db pnpm db:migrate` once), plus the development OAuth App's credentials and any `AUTH_SECRET`.

Schema lives in `db/schema.ts`; generate migrations with `pnpm db:generate` and never edit one after it has been applied. The initial migration includes the ledger balance trigger; preserve it in future migrations. Runtime schema creation is deliberately absent. `db/raw.ts` is a thin prepared-statement and atomic-batch layer over libSQL; all SQL is plain SQLite.

Layout: `lib/engine.ts` (shared physics and rulesets), `lib/matches.ts` (matchmaking, shots, settlement, snapshots), `lib/payments/` (custody and transfers), `app/api/*` (thin route handlers), `app/arena/` (client: `arena.tsx` shell, `use-game-session.ts` board and shot animation, `use-player-data.ts` polling, one file per page in `views/`).

Changing the physics: add a new ruleset number in `lib/engine.ts`, keep every older ruleset in `SUPPORTED_RULESETS` until no unsettled match uses it, and never alter an existing ruleset's behaviour. `tests/engine.test.ts` pins ruleset 2 to recorded replays and ruleset 3 to a frozen digest.

`pnpm test` (Node 24) runs every suite; none of them makes a network request. `tests/engine.test.ts` verifies deterministic mechanics, solid brick seams, ruleset 2 replays, ruleset 3 portable trigonometry and the per-shot work budget. The database suites run on a throwaway libSQL file built by the real migration runner, through the same adapter used against Turso. `tests/accounting.test.mjs` checks gem ledger constraints, idempotence and unique names directly in SQL. `tests/migrations.test.mjs` applies migration 0003 to pre-gem data and checks the demo-SOL-to-gems conversion. `tests/matches.test.mjs` runs the real matchmaking, shot, settlement and snapshot code: ruleset recording and replay, cancellation of unjoined forfeits (gems and devnet), settlement of unsettled matches only, absence of other players' IDs, per-match P&L, profile names and pictures, presence, the admin overview and rate limits. `tests/payments.test.mjs` exercises the real payment and settlement implementations with a fully mocked RPC: exact decimal amounts, cluster rejection, encryption/tampering, finalized-only credit, duplicate operations, pool serialization, identical-wire retries, expiry holds, provable-expiry refunds, abandoned-transfer unblocking, failure refunds, secret redaction, escrow conservation, tie refunds, atomic rollback, gem isolation, minimum deposits, the rent-exempt pool, treasury deposits and the live treasury snapshot. `pnpm typecheck`, `pnpm lint` and `pnpm build` are also checked. The payment service was run against the real devnet RPC (cluster check, wallets, blockhash, fees, balances), but real transfers could not be sent because the devnet faucet was rate-limited. A real GitHub OAuth round trip, migrations against a hosted Turso database and two-account testing have **not** been performed. The main client supports mouse, touch, keyboard aim and launch, and reduced motion preferences.
