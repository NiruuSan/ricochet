"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import type { AdminPlayer } from "@/lib/admin-players";
import { request } from "../api";
import { Avatar } from "../avatar";
import { fullSol } from "../funded-wallet";
import { timeAgo } from "../format";
import styles from "./admin.module.css";

const REFRESH_MS = 30_000;

/**
 * Everyone who made a profile, and — while the site is being built — the way to
 * take one off the register. Deleting is permanent and takes the matches the
 * player was in with it; whatever devnet SOL is left goes to the treasury.
 */
export function AdminPeople() {
  const dialog = useActionDialog();
  const [list, setList] = useState<AdminPlayer[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(
    () =>
      request<AdminPlayer[]>("/api/admin/players").then(
        (next) => (setList(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const remove = async (player: AdminPlayer) => {
    const answer = await dialog.promptSigned(
      `Delete ${player.name}?\n\nThe account, their runs, the matches they played — for both sides — their ledger, their wallet and their notifications are all removed. ${
        player.sol > 0 ? `Their ${fullSol(player.sol)} devnet SOL goes to the treasury.` : "Their balance is empty."
      }\n\nThis cannot be undone. Write the reason and confirm with your own authentication code.`,
      { title: "Delete this account", confirmLabel: "Delete account", danger: true },
    );
    if (!answer) return;
    setBusy(player.name);
    setError("");
    setNotice("");
    try {
      const done = await request<{ name: string; swept: number }>("/api/admin/players", { action: "delete", name: player.name, reason: answer.reason, code: answer.code });
      await load();
      setNotice(done.swept > 0 ? `${done.name} deleted · ${fullSol(done.swept)} SOL moved to the treasury.` : `${done.name} deleted.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const reset = async (player: AdminPlayer) => {
    const reason = await dialog.prompt(
      `Reset ${player.name}'s statistics?

Every game they played is removed: their runs, their scores, their profit and loss, their rank and their streaks all go back to nothing. The matches go too, so they leave their opponents' history as well.

Balances, wallets and the ledger are untouched. Write the reason; it is recorded in the audit log.`,
      { title: "Reset statistics", confirmLabel: "Reset statistics", danger: true },
    );
    if (reason === null) return;
    setBusy(player.name);
    setError("");
    setNotice("");
    try {
      const done = await request<{ name: string; matches: number; entries: number }>("/api/admin/players", { action: "reset", name: player.name, reason });
      await load();
      setNotice(`${done.name}'s statistics reset · ${done.matches} ${done.matches === 1 ? "match" : "matches"} and ${done.entries} tournament ${done.entries === 1 ? "entry" : "entries"} removed.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const shown = (list ?? []).filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <section className={styles.section}>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className={styles.search}>
        <Search size={16} />
        <PlayerNameInput value={search} onValueChange={setSearch} names={(list ?? []).map((player) => player.name)} placeholder="Search by player name" aria-label="Search players" />
      </div>
      {!list ? (
        <p className={styles.loading}>Loading players…</p>
      ) : !shown.length ? (
        <p className={styles.empty}>{search ? "No player by that name." : "Nobody has signed up yet."}</p>
      ) : (
        <>
          <p className={styles.fine}>
            {shown.length} of {list.length} {list.length === 1 ? "player" : "players"} · deleting is a development tool and removes their opponents&apos; history too.
          </p>
          <div className={styles.list}>
            {shown.map((player) => (
              <div key={player.name} className={`${styles.row} ${player.deleted ? styles.done : ""}`}>
                <div className={styles.who}>
                  <Avatar name={player.name} src={null} size={34} />
                  <div>
                    <b>
                      {player.deleted ? player.name : <Link href={`/players/${encodeURIComponent(player.name)}`}>{player.name}</Link>}
                      {!!player.suspended && (
                        <span className={`${styles.chip} ${styles.bad}`}>
                          <ShieldAlert size={11} /> Suspended
                        </span>
                      )}
                      {!!player.deleted && <span className={styles.chip}>Closed</span>}
                    </b>
                    <span>
                      Joined {timeAgo(player.created)} · seen {timeAgo(player.lastSeen)}
                    </span>
                  </div>
                </div>
                <div className={styles.cells}>
                  <div className={styles.cell}>
                    <span>Runs</span>
                    <b>{player.games.toLocaleString("en")}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Gems</span>
                    <b>{player.gems.toLocaleString("en")}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Devnet SOL</span>
                    <b>{fullSol(player.sol)}</b>
                  </div>
                </div>
                <div className={styles.actions}>
                  <button className="btn" disabled={busy === player.name} onClick={() => void reset(player)}>
                    <RotateCcw size={15} /> Reset stats
                  </button>
                  <button className="btn btn-danger" disabled={busy === player.name} onClick={() => void remove(player)}>
                    <Trash2 size={15} /> {busy === player.name ? "Working…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
