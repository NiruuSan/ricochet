# Bounce

Playable private prototype of the requested asynchronous 1v1 brick-breaker. This development version supports free gems (the in-game currency) and separately accounted Solana devnet payments. **Mainnet is disabled in code; this is not a real-money launch.** Gem amounts are whole gems; SOL amounts use integer lamports (1 SOL = 1,000,000,000 units).

Stack: Next.js 16 on Vercel, Turso (libSQL) database, Auth.js with GitHub sign-in.

## Bug-report attachments

Players can attach up to five images or videos (25 MB per file). Uploads go directly
from the browser to private Vercel Blob storage; the database holds metadata only.
The reporter and administrator can read submitted files through authenticated app
routes. The admin Bug reports tab previews images/videos and provides downloads.
Existing reports containing external links remain readable.

Setup in Vercel:

1. Open the Bounce project → **Storage** → **Create Database** → **Blob**.
2. Choose **Private**, then connect it to the environments that need attachments.
   Vercel adds `BLOB_READ_WRITE_TOKEN` to the project. Never use a `NEXT_PUBLIC_` token.
3. Set `CRON_SECRET` to a random secret of at least 32 characters if it is not already
   configured. The existing daily `/api/cron/sweep` job removes abandoned uploads
   and files whose reports/accounts were deleted, after a 24-hour grace period.
4. Redeploy. Production builds apply migration `0026_bug_attachments` automatically.
   For local development, copy the Blob token to `.env.local` and run
   `npm run db:migrate` against the intended local/preview database.

Text-only reports work without Blob credentials. Real uploads require the private
store; local automated tests mock Blob storage and exercise the real database and
authorization checks. Files must be uploaded and the report submitted within 24
hours; otherwise remove and reselect the file. Closing the dialog preserves the
current draft, but reloading the page clears unsent local files.

## Implemented

- Landing page, arena, saved matches, settled P&L leaderboard, login, balances/activity, rules/Q&A.
- Player profile at `/profile`: change the player name (unique regardless of case) and upload a profile picture. Pictures are cropped and resized to 256 px in the browser, checked by their bytes on the server (JPEG, PNG or WebP, at most 100 kB), and served from `/api/avatars/<random key>`, so a picture URL never reveals a player ID.
- Public player pages at `/players/<name>`, linked from leaderboard names and opponents, with all-time gem/devnet PNL and match counts. Public profiles expose a random recipient ID, never an authentication ID or wallet balance.
- Fee-free devnet SOL tips between funded Bounce balances, with recipient/amount review, atomic debit and credit, duplicate-request protection, and sent/received wallet history. Tips do not submit a separate on-chain transfer or enter match PNL.
- Arena flow: a lobby to pick practice or a 1v1 (gems or devnet SOL) and its entry, a full-screen matchmaking intro, the game, and a full-screen end-of-run recap (`GET /api/matches/<id>`, also reachable at `/?match=<id>`). The recap compares score, balls, boards cleared and rounds with the opponent's, whose stats and final board are revealed only once both runs are over; until then it shows the seat as open or the opponent as still playing and updates live.
- Notifications: settling a match notifies both players (win, loss or draw, with net result and scores) and a tip notifies its recipient, in the same batch as the ledger change. Players see a bell with unread count, a live toast for anything new, and a summary of what happened while they were away. IDs are deterministic per event, so nothing is announced twice, and never contain player IDs.
- Tournaments (`/tournaments`), created from the admin Tournaments tab: devnet SOL or gems, a paid entry (the pool is every entry, minus the 12% house share for SOL) or a free entry (the prize is reserved from the treasury house balance for SOL, paid by the house for gems), any whole number of places from 2 to 1,000, and a split of winner takes all, top 3 (50/30/20) or top 10 (20/17/14/12/10/8/7/5/4/3). Registration closes at the start; every entrant then plays one run on the same seed before the end. At the end the pool is paid by score: equal scores share their places, unused places are scaled onto those who placed, and entries are refunded if nobody played. Admins can end a tournament early or cancel it (refunding entries and returning a house prize). Entrants are notified of their result.
- Admin dashboard at `/admin`: registered, online (active in the last minute) and offline players; rolling 24-hour, 7-day and 30-day volumes (SOL staked, matches, deposits, withdrawals, house fees, and the gem equivalents); and the live devnet treasury (house balance, player balances owed, escrow, on-chain pool balance) with treasury deposit and withdrawal.
- GitHub, Google and Discord sign-in (Auth.js, stateless JWT sessions) with server-side authorization. A player's ID is `<provider>:<provider account ID>` (for example `github:123`), which never changes with their username or email. Each sign-in method is a separate player account; accounts are never merged by email. Google and Discord are enabled only when their `AUTH_<PROVIDER>_ID` and `AUTH_<PROVIDER>_SECRET` are set (redirect URIs `https://<your-domain>/api/auth/callback/google` and `/api/auth/callback/discord`). Player profile creation grants 2,000 gems once.
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

Gem matches have no house fee: winners receive the entire two-entry pot, and an unjoined cancellation refunds the full entry. Devnet SOL winners receive 1.76 times their stake; the house receives 12% of both entries. Ties refund both entries fully. From ruleset 4, matches are decided on score alone: a forfeit ends that run early with its score so far, the entry stays in the pot, and an unjoined forfeited match stays open for someone to beat that score. Matches created under earlier rulesets keep their rules: a single forfeit loses to a completed opponent, and an unjoined forfeit cancels the match (gems refunded in full, devnet SOL minus the 12% fee). Ruleset 4 also toughens bricks faster: new bricks gain +1 HP per round at first, rising to +4 per round from round 10 (HP 1, 2, 3, 4, 6, 8, 10, 13, 16, 20, then +4). Previously settled results retain their recorded payouts and fees. Open matches do not expire and reserved entries are not withdrawable.

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
4. **Environment variables** (Vercel → Project → Settings → Environment Variables, see `.env.example`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET` (`npx auth secret`), `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and optionally `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `AUTH_DISCORD_ID`/`AUTH_DISCORD_SECRET`, `RICOCHET_ADMIN_USER_ID` and the Solana settings above.
5. **Deploy.** Vercel detects Next.js; the default build (`pnpm run build` → `next build --webpack`) needs no extra settings. Keep webpack: see `next.config.ts`. Redeploy after changing environment variables.

## Development

`pnpm dev` runs Next.js locally. Put local settings in `.env.local`: `TURSO_DATABASE_URL=file:local.db` works without an account (run `TURSO_DATABASE_URL=file:local.db pnpm db:migrate` once), plus the development OAuth App's credentials and any `AUTH_SECRET`.

Schema lives in `db/schema.ts`; generate migrations with `pnpm db:generate` and never edit one after it has been applied. The initial migration includes the ledger balance trigger; preserve it in future migrations. Runtime schema creation is deliberately absent. `db/raw.ts` is a thin prepared-statement and atomic-batch layer over libSQL; all SQL is plain SQLite.

Layout: `lib/engine.ts` (shared physics and rulesets), `lib/matches.ts` (matchmaking, shots, settlement, snapshots), `lib/payments/` (custody and transfers), `app/api/*` (thin route handlers), `app/arena/` (client: `arena.tsx` shell, `use-game-session.ts` board and shot animation, `use-player-data.ts` polling, one file per page in `views/`).

Changing the physics: add a new ruleset number in `lib/engine.ts`, keep every older ruleset in `SUPPORTED_RULESETS` until no unsettled match uses it, and never alter an existing ruleset's behaviour. `tests/engine.test.ts` pins ruleset 2 to recorded replays and ruleset 3 to a frozen digest.

`pnpm test` (Node 24) runs every suite; none of them makes a network request. `tests/engine.test.ts` verifies deterministic mechanics, solid brick seams, ruleset 2 replays, ruleset 3 portable trigonometry and the per-shot work budget. The database suites run on a throwaway libSQL file built by the real migration runner, through the same adapter used against Turso. `tests/accounting.test.mjs` checks gem ledger constraints, idempotence and unique names directly in SQL. `tests/migrations.test.mjs` applies migration 0003 to pre-gem data and checks the demo-SOL-to-gems conversion. `tests/matches.test.mjs` runs the real matchmaking, shot, settlement and snapshot code: ruleset recording and replay, cancellation of unjoined forfeits (gems and devnet), settlement of unsettled matches only, absence of other players' IDs, per-match P&L, profile names and pictures, presence, the admin overview and rate limits. `tests/payments.test.mjs` exercises the real payment and settlement implementations with a fully mocked RPC: exact decimal amounts, cluster rejection, encryption/tampering, finalized-only credit, duplicate operations, pool serialization, identical-wire retries, expiry holds, provable-expiry refunds, abandoned-transfer unblocking, failure refunds, secret redaction, escrow conservation, tie refunds, atomic rollback, gem isolation, minimum deposits, the rent-exempt pool, treasury deposits and the live treasury snapshot. `pnpm typecheck`, `pnpm lint` and `pnpm build` are also checked. The payment service was run against the real devnet RPC (cluster check, wallets, blockhash, fees, balances), but real transfers could not be sent because the devnet faucet was rate-limited. A real GitHub OAuth round trip, migrations against a hosted Turso database and two-account testing have **not** been performed. The main client supports mouse, touch, keyboard aim and launch, and reduced motion preferences.

### Public profile migration

Vercel production builds run pending migrations before building the application, using the production `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. A migration failure stops deployment. Local and preview builds do not migrate databases automatically; use `npm run db:migrate` with the intended database configured. Migration `0004_public_player_ids` backfills random public IDs and assigns one to every new player; existing balances and match history are preserved. `tests/profiles-tips.test.mjs` verifies all-time PNL, historical results, profile privacy, tip idempotency, concurrent spending, failed-credit rollback, wallet history and devnet-only operation. `tests/deployment.test.mjs` reproduces the missing-column account-loading failure and checks that the production build migrates before publishing.


### Ranks, web push and growth metrics

Player rank badges now appear in match recaps (including the opponent while scores remain hidden), signed-in practice recaps, tournament result screens, standings and podiums. They use the existing settled devnet wager XP calculation. Tournament recaps receive their own standing even below the 200-row public standings limit.

Migration `0019_push_retention` adds daily authenticated activity, push subscriptions and a durable delivery queue. Production migrations still run through the existing build pipeline. For local or preview databases, run `npm run db:migrate` with the intended database configured before using the new code.

To enable web push:

1. Generate a persistent key pair with `npx web-push generate-vapid-keys`.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a real operator `mailto:` address or HTTPS URL) in the deployment environment, then redeploy. Keep the private key secret; the public key is served by the authenticated settings API. No keys are committed.
3. On HTTPS (or localhost), open the notification bell and select **Enable push notifications**. This explicitly asks for browser permission. On iOS, open Bounce from its installed Home Screen app. The same control disables notifications for this device.
4. Keep `CRON_SECRET` configured for the existing `/api/cron/sweep` schedule. Finishing a run queues its opponent's push in the same database transaction; `/api/game` dispatches after responding, including when the receiving player has closed the site. Transient failures retry during subsequent game requests or the scheduled sweep. The existing daily Hobby schedule is a backstop, so retries on a quiet site can wait until the next daily run. A more frequent authenticated scheduler can call this route if needed.

The queue uses per-device event IDs and leases, retries transient failures up to six attempts, removes expired subscriptions on 404/410 and expires queue rows after seven days. Notification tags collapse duplicate deliveries after a process failure; Web Push cannot guarantee exactly-once display. A click opens the authenticated match recap without navigating away from an active game. Push contents contain no scores or account identities. Subscriptions are device-specific; explicitly enabling another account on the same browser reassigns the subscription and clears queued notices for its previous owner. Changing VAPID keys requires renewing browser subscriptions. Delivery uses [web-push](https://github.com/web-push-libs/web-push#api-reference).

The admin overview includes:

- Daily/weekly/monthly active players: distinct accounts seen today or in the last 7/30 UTC calendar days, including today. Hidden tabs no longer send account polling heartbeats.
- Exact-day D1/D7/D30 retention: returned accounts divided by eligible signups, with counts and cohort dates. Each metric covers up to 30 signup days with a fully elapsed target return day. Only complete signup days after tracking began are eligible; past visits are not fabricated. Empty denominators display a dash.
- All-time registered-to-first-deposit conversion, first-deposit conversion within seven days for the latest 30 fully mature signup days, and first depositors over rolling 24h/7d/30d windows. Only positive finalized devnet deposits count, once per player, using finalization time. Treasury transfers, tips, pending/failed transfers and repeat deposits do not count as first deposits.

`tests/engagement.test.mjs` covers cohort maturity and UTC boundaries, daily deduplication, deposit exclusions, endpoint validation, transactional push queueing, concurrent dispatch, retries, expired subscriptions, account reassignment and rollback. Real browser push delivery still requires configured keys and permission on the target device.
