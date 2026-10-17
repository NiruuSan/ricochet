"use client";
import { useCallback, useEffect, useState } from "react";
import { Award, Users } from "lucide-react";
import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { useActionDialog } from "@/components/ui/action-dialog";
import { BADGE_IDS, BADGES, type BadgeId } from "@/lib/badges";
import { request } from "../api";
import { BadgeChip, BadgeInsignia } from "../badge-insignia";
import { timeAgo } from "../format";
import { toast } from "../feedback";
import cup from "./tournaments.module.css";
import styles from "./admin.module.css";

type Roster = { counts: Record<BadgeId, number>; players: number; recent: { name: string; badge: BadgeId; granted: number }[] };

/**
 * The badges the administrator gives: Beta tester and Founding player. Either
 * opens the Blueprint theme for the player who holds it (lib/badges.ts).
 */
export function AdminBadges() {
  const dialog = useActionDialog();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [name, setName] = useState("");
  const [badge, setBadge] = useState<BadgeId>("beta");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      request<Roster>("/api/admin/badges").then(
        (next) => (setRoster(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const send = async (action: "grant" | "revoke" | "grant-all", said: (done: { name?: string; granted?: number }) => string) => {
    setBusy(action);
    setError("");
    try {
      const next = await request<{ done: { name?: string; granted?: number }; roster: Roster }>("/api/admin/badges", { action, name: name.trim(), badge });
      setRoster(next.roster);
      toast(said(next.done));
      if (action !== "grant-all") setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const everyone = async () => {
    const without = roster ? roster.players - roster.counts[badge] : 0;
    if (!(await dialog.confirm(`Give ${BADGES[badge].name} to every player who does not have it yet (${without})? Each of them is told, and the Blueprint theme opens for them.`, { title: "Badge for everyone", confirmLabel: "Give it to everyone" }))) return;
    void send("grant-all", (done) => `${BADGES[badge].name} given to ${done.granted ?? 0} ${done.granted === 1 ? "player" : "players"}.`);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>
          <Award size={16} /> Badges
        </h3>
        {roster && (
          <span className={styles.badgeCounts}>
            {BADGE_IDS.map((id) => (
              <span key={id}>
                <BadgeInsignia badge={id} size={15} /> {roster.counts[id]} {BADGES[id].name.toLowerCase()}
                {roster.counts[id] === 1 ? "" : "s"}
              </span>
            ))}
          </span>
        )}
      </div>
      <p className={styles.fine}>A badge shows beside the player&apos;s name on their profile and the leaderboards, and either one opens the Blueprint theme for them.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Form
        className={styles.badgeForm}
        onSubmit={(e) => {
          e.preventDefault();
          void send("grant", (done) => `${BADGES[badge].name} given to ${done.name}.`);
        }}
      >
        <div className="field">
          <label htmlFor="badge-player">Player</label>
          <PlayerNameInput id="badge-player" scope="admin" value={name} onValueChange={setName} maxLength={32} placeholder="Exact public name" />
        </div>
        <div className="field">
          Badge
          <div className={cup.segmented}>
            {BADGE_IDS.map((id) => (
              <button type="button" key={id} aria-pressed={badge === id} onClick={() => setBadge(id)}>
                <BadgeInsignia badge={id} size={15} /> {BADGES[id].name}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.badgeActions}>
          <button className="btn btn-primary" disabled={!!busy || !name.trim()}>
            {busy === "grant" ? "Giving…" : "Give"}
          </button>
          <button type="button" className="btn" disabled={!!busy || !name.trim()} onClick={() => void send("revoke", (done) => `${BADGES[badge].name} taken back from ${done.name}.`)}>
            {busy === "revoke" ? "Taking back…" : "Take back"}
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void everyone()}>
            <Users size={15} /> {busy === "grant-all" ? "Giving…" : `Give ${BADGES[badge].name} to everyone`}
          </button>
        </div>
      </Form>
      {!!roster?.recent.length && (
        <ul className={styles.badgeRecent}>
          {roster.recent.map((row) => (
            <li key={`${row.name}:${row.badge}`}>
              <BadgeChip badge={row.badge} compact />
              <b>{row.name}</b>
              <span>{timeAgo(row.granted)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
