"use client";
import { useState } from "react";
import { Swords } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STAKES, winnerPayout, type Asset } from "@/lib/api-types";
import { amount, currency, units } from "./format";
import styles from "./views/friends.module.css";

export type Entry = { asset: Asset; stake: number };

type Props = {
  name: string;
  /** What the challenger holds, per currency, to grey out what they cannot enter. */
  balance: (asset: Asset) => number;
  solConfigured: boolean;
  busy: boolean;
  onChallenge: (entry: Entry) => void | Promise<void>;
};

const MODES = [
  { key: "free", label: "Friendly", note: "No entry" },
  { key: "gems", label: "Gems", note: "Winner takes both" },
  { key: "devnet", label: "Devnet SOL", note: "12% house fee" },
] as const;

/**
 * The button that puts a board between two friends, and the choice that comes
 * first: for nothing, for gems, or for devnet SOL. Nothing is sent until they
 * pick — a challenge is a real entry, and an entry is never assumed.
 */
export function ChallengeFriend({ name, balance, solConfigured, busy, onChallenge }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"free" | Asset>("free");
  const [index, setIndex] = useState(1);

  const asset: Asset = mode === "free" ? "gems" : mode;
  const stake = mode === "free" ? 0 : STAKES[asset][index];
  const affordable = balance(asset) >= stake;

  const send = async () => {
    await onChallenge({ asset, stake });
    setOpen(false);
  };

  return (
    <>
      <button className="btn" disabled={busy} onClick={() => setOpen(true)}>
        <Swords size={15} /> Challenge
      </button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Challenge {name}</DialogTitle>
          <DialogDescription>
            Pick what this one is worth. {name} gets the invitation, the seat is theirs alone, and your board is ready as soon as you send it.
          </DialogDescription>

          <div className={styles.modes}>
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={styles.mode}
                aria-pressed={mode === m.key}
                disabled={m.key === "devnet" && !solConfigured}
                onClick={() => setMode(m.key)}
              >
                {m.label}
                <small>{m.key === "devnet" && !solConfigured ? "Coming soon" : m.note}</small>
              </button>
            ))}
          </div>

          {mode !== "free" && (
            <>
              <div className={styles.stakes}>
                {STAKES[asset].map((s, i) => (
                  <button key={s} type="button" className={styles.stake} aria-pressed={i === index} disabled={balance(asset) < s} onClick={() => setIndex(i)}>
                    {units(s, asset)}
                    <small>{currency(asset).toUpperCase()}</small>
                  </button>
                ))}
              </div>
              <p className="fine" style={{ marginTop: 8 }}>
                You hold {amount(balance(asset), asset)}.
                {!affordable && " Pick a smaller entry."}
              </p>
            </>
          )}

          <div className={styles.prize}>
            <div>
              <span>Your entry</span>
              <b>{mode === "free" ? "Nothing" : amount(stake, asset)}</b>
            </div>
            <div>
              <span>Winner receives</span>
              <b className="lime">{mode === "free" ? "The win" : amount(winnerPayout(stake, asset), asset)}</b>
            </div>
          </div>

          <div className="row-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !affordable} onClick={() => void send()}>
              <Swords size={15} /> {busy ? "Opening…" : "Send challenge"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
