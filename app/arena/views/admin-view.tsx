"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { gameAction } from "../api";
import { FundedWallet } from "../funded-wallet";
import { sol } from "../format";
import type { PlayerState } from "../arena";

type Summary = { fees: number; settled_matches: number };

export function AdminView({ player }: { player: PlayerState }) {
  const { data, setError } = player;
  const [summary, setSummary] = useState<Summary | null>(null);
  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        TREASURY
      </div>
      <h1>House overview.</h1>
      <p className="muted">Earned devnet fees and demo accounting. Mainnet payments are disabled.</p>
      <section className="panel">
        {data.isAdmin ? (
          <>
            <FundedWallet treasury />
            <button
              className="btn"
              onClick={async () => {
                try {
                  setSummary(await gameAction<Summary>({ action: "admin" }));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Load treasury summary
            </button>
            {summary && (
              <div className="stat-grid">
                <div className="stat-card">
                  Accrued demo fees<b>{sol(summary.fees)} SOL</b>
                </div>
                <div className="stat-card">
                  Settled matches<b>{summary.settled_matches}</b>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <Lock style={{ marginBottom: 20 }} />
            <h2>Administrator access required.</h2>
            <p className="muted" style={{ marginTop: 12 }}>
              This area requires a configured administrator account. Treasury controls are available only to the configured administrator.
            </p>
          </>
        )}
      </section>
    </section>
  );
}
