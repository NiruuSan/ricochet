"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PAYOUT_SHARES, TOURNAMENT_FEE_PERCENT, type AdminTournament, type Asset, type PayoutPreset } from "@/lib/api-types";
import { request } from "../api";
import { amount } from "../format";
import { entryLabel, ordinal, PAYOUT_LABELS, STATUS_LABELS, timing } from "../tournament-format";
import styles from "./tournaments.module.css";

const HOUR = 3_600_000;

/** A `datetime-local` value in the browser's time zone. */
function localInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Display units to base units, for the preview only; the server parses amounts exactly. */
const toUnits = (value: string, asset: Asset) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return asset === "devnet" ? Math.round(n * 1e9) : Math.floor(n);
};

function CreateTournament({ solConfigured, onCreated }: { solConfigured: boolean; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [asset, setAsset] = useState<Asset>(solConfigured ? "devnet" : "gems");
  const [entry, setEntry] = useState<"paid" | "free">("paid");
  const [fee, setFee] = useState("");
  const [prize, setPrize] = useState("");
  const [payout, setPayout] = useState<PayoutPreset>("top3");
  const [places, setPlaces] = useState("16");
  const [startsAt, setStartsAt] = useState(() => localInput(Date.now() + HOUR));
  const [endsAt, setEndsAt] = useState(() => localInput(Date.now() + 25 * HOUR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const seats = Number(places);
  const pool = entry === "paid" ? Math.floor((toUnits(fee, asset) * (seats || 0) * (100 - TOURNAMENT_FEE_PERCENT[asset])) / 100) : toUnits(prize, asset);
  const shares = PAYOUT_SHARES[payout];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/tournaments", {
        action: "create",
        name,
        asset,
        entry,
        entryFee: fee.trim(),
        prize: prize.trim(),
        payout,
        places: seats,
        startsAt: new Date(startsAt).getTime(),
        endsAt: new Date(endsAt).getTime(),
      });
      setNotice(`“${name}” is scheduled.`);
      setName("");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unit = asset === "devnet" ? "SOL" : "gems";
  return (
    <form className={`${styles.panel} ${styles.form}`} onSubmit={submit}>
      <h2 className={styles.full} style={{ fontSize: 20 }}>
        New tournament
      </h2>
      {error && (
        <p className={`error ${styles.full}`} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={`success ${styles.full}`} role="status">
          {notice}
        </p>
      )}
      <label className={`field ${styles.full}`}>
        Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={60} required placeholder="Friday Night Cup" />
      </label>
      <div className="field">
        Currency
        <div className={styles.segmented}>
          <button type="button" aria-pressed={asset === "devnet"} disabled={!solConfigured} onClick={() => setAsset("devnet")}>
            Devnet SOL
          </button>
          <button type="button" aria-pressed={asset === "gems"} onClick={() => setAsset("gems")}>
            Gems
          </button>
        </div>
      </div>
      <div className="field">
        Entry
        <div className={styles.segmented}>
          <button type="button" aria-pressed={entry === "paid"} onClick={() => setEntry("paid")}>
            Paid · players fund the pool
          </button>
          <button type="button" aria-pressed={entry === "free"} onClick={() => setEntry("free")}>
            Free · {asset === "devnet" ? "treasury" : "house"} funds the prize
          </button>
        </div>
      </div>
      {entry === "paid" ? (
        <label className="field">
          Entry fee · {unit}
          <input className="input" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" required placeholder={asset === "devnet" ? "0.1" : "100"} />
        </label>
      ) : (
        <label className="field">
          Cash prize · {unit}
          <input className="input" value={prize} onChange={(e) => setPrize(e.target.value)} inputMode="decimal" required placeholder={asset === "devnet" ? "1.5" : "5000"} />
        </label>
      )}
      <label className="field">
        Places
        <input className="input" type="number" min={2} max={1000} step={1} value={places} onChange={(e) => setPlaces(e.target.value)} required />
      </label>
      <div className={`field ${styles.full}`}>
        Prize split
        <div className={styles.segmented}>
          {(Object.keys(PAYOUT_SHARES) as PayoutPreset[]).map((key) => (
            <button type="button" key={key} aria-pressed={payout === key} onClick={() => setPayout(key)}>
              {PAYOUT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Starts
        <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
      </label>
      <label className="field">
        Ends
        <input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
      </label>
      <div className={styles.preview}>
        <div>
          <span className={styles.muted}>{entry === "paid" ? `Prize pool when all ${seats || 0} places are taken` : "Prize reserved now"}</span>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#c6f564" }}>{amount(pool, asset)}</div>
          <span className={styles.muted}>
            {entry === "paid"
              ? asset === "devnet"
                ? "Entries minus the 12% house share."
                : "Every entry goes into the pool."
              : asset === "devnet"
                ? "Taken from the treasury house balance when you create it; returned if cancelled."
                : "Paid by the house when the tournament ends."}
          </span>
        </div>
        <div className={styles.shares}>
          {shares.map((share, i) => (
            <span key={i}>
              {ordinal(i + 1)} {share}% · {amount(Math.floor((pool * share) / 100), asset)}
            </span>
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy}>
          <Plus /> {busy ? "Creating…" : "Create tournament"}
        </button>
      </div>
    </form>
  );
}

export function AdminTournaments({ solConfigured }: { solConfigured: boolean }) {
  const [list, setList] = useState<AdminTournament[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      request<AdminTournament[]>("/api/admin/tournaments").then(
        (next) => (setList(next), setError(""), setNow(Date.now())),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    request<AdminTournament[]>("/api/admin/tournaments").then(
      (next) => active && setList(next),
      (e: Error) => active && setError(e.message),
    );
    const timer = setInterval(() => !document.hidden && void load(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const act = async (action: "cancel" | "close", t: AdminTournament) => {
    const question = action === "cancel" ? `Cancel “${t.name}”? Every entry is refunded.` : `End “${t.name}” now and pay out the current standings?`;
    if (!window.confirm(question)) return;
    setBusy(t.id);
    setError("");
    try {
      await request("/api/admin/tournaments", { action, id: t.id });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <CreateTournament solConfigured={solConfigured} onCreated={() => void load()} />
      <h2 style={{ margin: "30px 0 14px" }}>Tournaments</h2>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!list ? (
        <p className="muted">Loading…</p>
      ) : !list.length ? (
        <p className={styles.empty}>No tournaments yet. Create the first one above.</p>
      ) : (
        list.map((t) => (
          <div key={t.id} className={styles.adminRow}>
            <div>
              <b>{t.name}</b>
              <span className={styles.muted}>
                {STATUS_LABELS[t.status]} · {timing(t, now)} · {t.asset === "devnet" ? "Devnet SOL" : "Gems"}
              </span>
            </div>
            <div>
              <b>
                {t.entrants}/{t.places}
              </b>
              <span className={styles.muted}>
                {t.played} played · {t.finished} done
              </span>
            </div>
            <div>
              <b>{amount(t.pot, t.asset)}</b>
              <span className={styles.muted}>{PAYOUT_LABELS[t.payout]}</span>
            </div>
            <div>
              <b>{entryLabel(t)}</b>
              <span className={styles.muted}>entry</span>
            </div>
            <div className="row-actions">
              <Link className="btn" href={`/tournaments/${t.id}`}>
                View
              </Link>
              {t.status === "live" && (
                <button className="btn" disabled={busy === t.id} onClick={() => void act("close", t)}>
                  End now
                </button>
              )}
              {(t.status === "registration" || t.status === "live") && (
                <button className="btn" style={{ borderColor: "#ff8091", color: "#ffb2bf" }} disabled={busy === t.id} onClick={() => void act("cancel", t)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}
