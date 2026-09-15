"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, Check, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MIN_DEPOSIT, type Transfer, type TreasurySnapshot } from "@/lib/api-types";
import { request } from "./api";

type WalletData = {
  configured: boolean;
  address?: string | null;
  balance: number;
  /** Finalized SOL at the deposit address that has not been swept into the pool yet. */
  detected?: number;
  transfers: Transfer[];
  tips?: { id: string; amount: number; created: number; name: string }[];
} & Partial<Omit<TreasurySnapshot, "configured" | "address" | "balance" | "detected" | "transfers">>;

const OPEN_STATUSES = ["pending", "review"];
const isOpen = (t: Transfer) => OPEN_STATUSES.includes(t.status);
export const fullSol = (lamports: number) => (lamports / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });
export const explorer = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

const TRANSFER_LABELS: Record<string, string> = { deposit: "Deposit", withdrawal: "Withdrawal", treasury: "Treasury withdrawal" };
const STATUS_LABELS: Record<string, string> = { pending: "Confirming…", review: "Confirming…", finalized: "Confirmed", failed: "Failed", expired: "Expired · refunded" };

/** Poll faster while a transfer is confirming, so balances update without clicking. */
const pollMs = (data: WalletData | null, treasury: boolean) => (data?.transfers.some(isOpen) || data?.open?.length ? 5_000 : treasury ? 10_000 : 15_000);

export function FundedWallet({ treasury = false }: { treasury?: boolean }) {
  const path = treasury ? "/api/treasury" : "/api/wallet";
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stage, setStage] = useState<"edit" | "confirm">("edit");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [copied, setCopied] = useState(false);
  // Operation IDs survive failed attempts, so a retry can never create a second payment.
  const withdrawalId = useRef<string | null>(null);
  const depositId = useRef<string | null>(null);
  const autoRef = useRef(false);

  const load = useCallback(
    () =>
      request<WalletData>(path).then(
        (next) => {
          setData(next);
          return next;
        },
        (e: Error) => {
          setError(e.message);
          return null;
        },
      ),
    [path],
  );

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<Record<string, unknown>>(path, body);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const deposit = async () => {
    depositId.current ??= crypto.randomUUID();
    if (await act({ action: "deposit", id: depositId.current })) depositId.current = null;
  };

  // Background work: credit SOL that arrived at the deposit address, and follow
  // open transfers until they settle. Failures are silent; the next poll retries.
  const autoStep = useCallback(
    async (current: WalletData) => {
      if (autoRef.current || !current.configured) return;
      autoRef.current = true;
      try {
        const open = [...current.transfers.filter(isOpen), ...(current.open ?? [])];
        const depositOpen = current.transfers.some((t) => t.kind === "deposit" && isOpen(t));
        let changed = false;
        if ((current.detected ?? 0) >= MIN_DEPOSIT && !depositOpen) {
          depositId.current ??= crypto.randomUUID();
          await request(path, { action: "deposit", id: depositId.current }).then(
            () => {
              depositId.current = null;
              changed = true;
            },
            () => {},
          );
        }
        // The treasury follows every player's transfers with one sweep request.
        const checks = treasury ? (open.length ? [{ action: "reconcile_all" }] : []) : [...new Set(open.map((t) => t.id))].map((id) => ({ action: "reconcile", id }));
        for (const body of checks) {
          await request(path, body).then(
            () => (changed = true),
            () => {},
          );
        }
        if (changed) await load();
      } finally {
        autoRef.current = false;
      }
    },
    [load, path, treasury],
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await load();
      if (!active) return;
      if (next && !document.hidden) await autoStep(next);
      if (active) timer = setTimeout(tick, pollMs(next, treasury));
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [autoStep, load, treasury]);

  const withdraw = async () => {
    withdrawalId.current ??= crypto.randomUUID();
    if (await act({ action: "withdraw", id: withdrawalId.current, amount, destination })) {
      setDialogOpen(false);
      setStage("edit");
      withdrawalId.current = null;
      setAmount("");
      setDestination("");
    }
  };

  const recheckAll = async () => {
    const result = (await act({ action: "reconcile_all" })) as { checked: number; resolved: number; failed: number } | null;
    if (result) setNotice(`Checked ${result.checked} open transfer(s): ${result.resolved} resolved, ${result.failed} could not be checked.`);
  };

  const incoming = data?.transfers.find((t) => t.kind === "deposit" && isOpen(t));

  return (
    <section className="panel funded-wallet" style={{ margin: "26px 0 32px" }}>
      <div className="panel-title">
        <h2>{treasury ? "Solana house treasury" : "Your Solana wallet"}</h2>
        <span className="demo-tag">DEVNET · TEST SOL</span>
      </div>
      <p className="muted">
        {treasury
          ? "Deposits add SOL to the house. Withdrawals can only spend the house balance; player balances and match pots stay untouchable."
          : "Fund devnet matches using Solana’s test network. Devnet SOL has no monetary value and is separate from gems."}
      </p>
      {error && (
        <p className="error" role="alert" style={{ marginTop: 15 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="fine" role="status" style={{ marginTop: 15 }}>
          {notice}
        </p>
      )}
      {!data ? (
        <p className="muted" style={{ marginTop: 20 }}>
          {error ? "Sign in and create a player profile to use the wallet." : "Loading your wallet…"}
        </p>
      ) : !data.configured ? (
        <div className="callout">
          <ShieldCheck />
          <div>
            <h3>Solana funding is not connected yet.</h3>
            <p>
              {treasury ? (
                <>
                  Set <code>SOLANA_NETWORK=devnet</code>, <code>SOLANA_RPC_URL</code> and <code>SOLANA_VAULT_KEY</code> in the deployment settings, then
                  redeploy.
                </>
              ) : (
                "Devnet wallets will be available once the payment service is configured. Real SOL is not accepted."
              )}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="wallet-value">
            {fullSol(data.balance)} <small>{treasury ? "devnet SOL · house balance" : "devnet SOL available"}</small>
          </div>
          {treasury && (
            <div className="live-grid">
              <div>
                <span>Pool wallet on-chain</span>
                <b>{data.poolOnChain === null ? "Unavailable" : `${fullSol(data.poolOnChain ?? 0)} SOL`}</b>
              </div>
              <div>
                <span>Owed to players</span>
                <b>{fullSol(data.playerBalances ?? 0)} SOL</b>
              </div>
              <div>
                <span>Match pots in escrow</span>
                <b>{fullSol(data.escrow ?? 0)} SOL</b>
              </div>
              <div>
                <span>Unallocated on-chain</span>
                <b>
                  {data.poolOnChain === null || data.poolOnChain === undefined
                    ? "—"
                    : `${fullSol(data.poolOnChain - (data.playerBalances ?? 0) - (data.escrow ?? 0) - data.balance)} SOL`}
                </b>
              </div>
              {data.poolAddress && (
                <a className="fine lime" href={explorer("address", data.poolAddress)} target="_blank" rel="noreferrer">
                  View pool wallet <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          {data.address && (
            <>
              <label className="field">
                {treasury ? "Treasury deposit address · devnet only" : "Your deposit address · devnet only"}
                <input readOnly className="input" value={data.address} onFocus={(e) => e.target.select()} />
              </label>
              <div className="row-actions">
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(data.address!);
                      setCopied(true);
                    } catch {
                      setError("Select and copy the address above.");
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a className="btn" href={explorer("address", data.address)} target="_blank" rel="noreferrer">
                  View on explorer <ExternalLink />
                </a>
              </div>
              {incoming ? (
                <p className="callout-inline" role="status">
                  <RefreshCw size={14} className="spin" /> Crediting {fullSol(incoming.amount)} SOL… this takes about 30 seconds.
                </p>
              ) : (data.detected ?? 0) >= MIN_DEPOSIT ? (
                <p className="callout-inline" role="status">
                  <RefreshCw size={14} className="spin" /> {fullSol(data.detected!)} SOL received. Crediting it automatically…
                </p>
              ) : (data.detected ?? 0) > 0 ? (
                <p className="callout-inline" role="status">
                  {fullSol(data.detected!)} SOL received, below the 0.001 SOL minimum. Send a little more to credit it.
                </p>
              ) : (
                <p className="fine" style={{ marginTop: 12 }}>
                  Send devnet SOL to this address from any wallet (for example Phantom or Solflare set to devnet, or faucet.solana.com). It is credited
                  automatically once final, usually within a minute. Minimum 0.001 SOL; the network fee is deducted.
                </p>
              )}
            </>
          )}
          <div className="wallet-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void deposit()}>
              <RefreshCw />
              Check deposit now
            </button>
            <button
              className="btn"
              disabled={busy || data.balance <= 0}
              onClick={() => {
                setDialogOpen(true);
                setStage("edit");
              }}
            >
              <ArrowUpFromLine />
              {treasury ? "Withdraw from treasury" : "Withdraw test SOL"}
            </button>
          </div>
          <p className="fine">
            Withdrawal amounts plus network fees are reserved immediately. If a transaction expires without landing, the full reserved amount returns
            automatically.
          </p>
          {data.transfers.length > 0 && (
            <div className="table-card" style={{ marginTop: 25 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transfer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Network fee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transfers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        {TRANSFER_LABELS[t.kind] ?? t.kind}
                        <div className="fine">{new Date(t.created).toLocaleString()}</div>
                      </TableCell>
                      <TableCell>{fullSol(t.amount)}</TableCell>
                      <TableCell>{fullSol(t.fee)}</TableCell>
                      <TableCell>
                        <b className={t.status === "finalized" ? "lime" : ""}>{STATUS_LABELS[t.status] ?? t.status}</b>
                        {t.error && !isOpen(t) && (
                          <p className="fine" style={{ maxWidth: 250, whiteSpace: "normal" }}>
                            {t.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="row-actions">
                          <a className="btn" href={explorer("tx", t.signature)} target="_blank" rel="noreferrer" aria-label="View transaction">
                            <ExternalLink />
                          </a>
                          {isOpen(t) && (
                            <button className="btn" disabled={busy} onClick={() => void act({ action: "reconcile", id: t.id })}>
                              Recheck
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!treasury && !!data.tips?.length && (
            <section style={{ marginTop: 25 }}>
              <h3 style={{ marginBottom: 14 }}>Tips · devnet SOL</h3>
              <div className="table-card">
                <Table>
                  <TableHeader><TableRow><TableHead>Tip</TableHead><TableHead>Player</TableHead><TableHead>Amount · SOL</TableHead></TableRow></TableHeader>
                  <TableBody>{data.tips.map((tip) => <TableRow key={tip.id}>
                    <TableCell>{tip.amount > 0 ? "Received" : "Sent"}<div className="fine">{new Date(tip.created).toLocaleString()}</div></TableCell>
                    <TableCell><Link className="lime" href={`/players/${encodeURIComponent(tip.name)}`}>{tip.name}</Link></TableCell>
                    <TableCell className={tip.amount > 0 ? "lime" : ""}>{tip.amount > 0 ? "+" : ""}{fullSol(tip.amount)}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </div>
            </section>
          )}
          {treasury && !!data.open?.length && (
            <div style={{ marginTop: 20 }}>
              <h3>Open transfers (all players)</h3>
              <p className="fine">
                Any open transfer from the player pool blocks the next withdrawal until it resolves. They are rechecked automatically; rechecking
                finalizes, refunds once provably expired, or resubmits the same signed bytes. No replacement payment is ever created.
              </p>
              <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void recheckAll()}>
                <RefreshCw />
                Recheck all
              </button>
              {data.open.map((t) => (
                <div key={t.id} className="math-line" style={{ gap: 12, marginTop: 12 }}>
                  <span>
                    {TRANSFER_LABELS[t.kind] ?? t.kind} · {fullSol(t.amount)} SOL · {t.signature.slice(0, 12)}…
                  </span>
                  <button className="btn" disabled={busy} onClick={() => void act({ action: "reconcile", id: t.id })}>
                    Recheck
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!busy) setDialogOpen(v);
        }}
      >
        <DialogContent className="dialog-dark">
          <DialogTitle>{stage === "confirm" ? "Confirm your transfer" : treasury ? "Withdraw from the treasury" : "Withdraw devnet SOL"}</DialogTitle>
          <DialogDescription>
            {stage === "confirm"
              ? "Confirm the full destination address and amount. A blockchain transfer cannot be reversed. The network fee is added to the reserved amount."
              : "Enter an external Solana wallet on devnet. These funds are for testing only."}
          </DialogDescription>
          {stage === "edit" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                withdrawalId.current = null;
                setStage("confirm");
              }}
            >
              <label className="field">
                Destination address
                <input
                  className="input"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  required
                  minLength={32}
                  maxLength={44}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Amount · devnet SOL
                <input
                  className="input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,9})?"
                  placeholder="0.1"
                />
              </label>
              <p className="fine">Available: {fullSol(data?.balance ?? 0)} SOL, including the network fee.</p>
              <button className="btn btn-primary full" type="submit">
                Review transfer
              </button>
            </form>
          ) : (
            <>
              <p style={{ overflowWrap: "anywhere" }}>
                To: <strong>{destination}</strong>
              </p>
              <p>
                Amount: <strong>{amount} devnet SOL</strong>
              </p>
              <p className="fine">A network fee of up to 0.001 devnet SOL will be added. Available balance must cover both the transfer and the fee.</p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row-actions">
                <button className="btn" disabled={busy} onClick={() => setStage("edit")}>
                  Back
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void withdraw()}>
                  {busy ? "Submitting…" : "Confirm transfer"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
