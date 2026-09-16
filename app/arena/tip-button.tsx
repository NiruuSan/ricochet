"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Gift } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PublicPlayerProfile, TipReceipt } from "@/lib/api-types";
import { parseSol } from "@/lib/payments/policy";
import type { PlayerState } from "./arena";
import { request, RequestError } from "./api";
import { fullSol } from "./funded-wallet";

type Operation = { id: string; recipient: string; amount: string };

export function TipButton({ profile, player }: { profile: PublicPlayerProfile; player: PlayerState }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<TipReceipt | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const inFlight = useRef(false);
  const storageKey = `ricochet:tip:${player.data.player?.publicId}:${profile.publicId}`;

  const show = () => {
    setError(""); setReceipt(null); setReview(!!operation); setRestoreFailed(false);
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const pending: Operation = JSON.parse(saved);
        if (pending && pending.recipient === profile.publicId && typeof pending.id === "string" && typeof pending.amount === "string") {
          setOperation(pending); setAmount(pending.amount); setReview(true);
        } else throw new Error("Invalid saved tip");
      }
    } catch { setRestoreFailed(true); setError("The previous tip could not be restored. Check your wallet activity before continuing."); }
    setOpen(true);
  };
  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const pending = operation ?? { id: crypto.randomUUID(), recipient: profile.publicId, amount };
      // Preserve this exact request through connection errors, closing the dialog and reloads.
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      setOperation(pending);
      const next = await request<TipReceipt>("/api/tips", pending);
      setReceipt(next);
      setOperation(null);
      try { sessionStorage.removeItem(storageKey); } catch { /* Replaying a saved receipt is harmless. */ }
      await player.refresh();
    } catch (e) {
      if (e instanceof RequestError && e.code === "TIP_NOT_SENT") {
        setOperation(null); setReview(false);
        try { sessionStorage.removeItem(storageKey); } catch { /* The server confirmed this tip did not move funds. */ }
      }
      setError((e as Error).message);
    }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <>
    <button type="button" className="btn btn-primary" onClick={show}><Gift /> Tip</button>
    <Dialog open={open} onOpenChange={(value) => { if (!inFlight.current) setOpen(value); }}>
      <DialogContent className="dialog-dark">
        <DialogTitle>{receipt ? "Tip sent" : `Tip ${profile.name}`}</DialogTitle>
        <DialogDescription>Send devnet SOL from your available Bounce balance directly to this player’s balance. No tip fee. Test funds only.</DialogDescription>
        {error && <div className="error" role="alert">{error}</div>}
        {receipt ? <>
          <p className="success" role="status">Sent {fullSol(receipt.amount)} devnet SOL to {receipt.recipient}.</p>
          <button className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
        </> : restoreFailed ? <Link className="btn" href="/wallet">Check wallet activity</Link> : !player.loaded ? <p>Loading your wallet…</p> : !player.data.player ? <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>Sign in or create a player to tip</Link>
          : !player.data.launch?.configured ? <p>Devnet tipping is currently unavailable.</p> : <>
            <p className="fine">Available: {fullSol(player.data.cashBalance ?? 0)} devnet SOL. <Link className="lime" href="/wallet">Fund wallet</Link></p>
            {review ? <>
              <div className="math-line"><span>Recipient</span><strong>{profile.name}</strong></div>
              <div className="math-line"><span>Tip amount</span><strong>{amount} devnet SOL</strong></div>
              <p className="fine">The amount will leave your balance immediately. Confirm the recipient and amount before sending.</p>
              {operation && <p className="fine">Retry checks the same tip and cannot send it twice.</p>}
              <div className="row-actions">
                {!operation && <button className="btn" disabled={busy} onClick={() => setReview(false)}>Edit amount</button>}
                <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : operation ? "Retry tip" : "Confirm tip"}</button>
              </div>
            </> : <form onSubmit={(event) => {
              event.preventDefault(); setError("");
              try {
                const lamports = parseSol(amount);
                if (lamports > (player.data.cashBalance ?? 0)) throw new Error("Not enough available devnet SOL. Fund your wallet or choose a smaller tip.");
                setReview(true);
              } catch (e) { setError((e as Error).message); }
            }}>
              <label className="field">Amount · devnet SOL<input className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required autoComplete="off" /></label>
              <button className="btn btn-primary full" style={{ marginTop: 18 }}>Review tip</button>
            </form>}
          </>}
      </DialogContent>
    </Dialog>
  </>;
}
