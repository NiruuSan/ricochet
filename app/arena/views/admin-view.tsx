"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Lock } from "lucide-react";
import type { AdminOverview } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { FundedWallet } from "../funded-wallet";
import { units } from "../format";
import type { PlayerState } from "../arena";
import { AdminAntiCheat } from "./admin-anti-cheat";
import { AdminGames } from "./admin-games";
import { AdminPartners } from "./admin-partners";
import { AdminPeople } from "./admin-people";
import { AdminReports } from "./admin-reports";
import { AdminRace } from "./admin-race";
import { AdminTournaments } from "./admin-tournaments";
import { AdminSecurity } from "./admin-security";
import tournamentStyles from "./tournaments.module.css";
import { AdminVolume } from "./volume-chart";
import { AdminGrowth } from "./admin-growth";

const REFRESH_MS = 15_000;
const noSubscription = () => () => {};

export function AdminView({ player }: { player: PlayerState }) {
  const { data, loaded } = player;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const requestedReview = useSyncExternalStore(noSubscription, () => new URLSearchParams(window.location.search).get("tab") === "anti-cheat", () => false);
  const [chosenTab, setTab] = useState<"overview" | "games" | "tournaments" | "race" | "players" | "reports" | "partners" | "anti-cheat" | "security" | null>(null);
  const tab = chosenTab ?? (requestedReview ? "anti-cheat" : "overview");

  useEffect(() => {
    if (!data.isAdmin) return;
    let active = true;
    const load = () =>
      request<AdminOverview>("/api/admin").then(
        (next) => active && (setOverview(next), setError("")),
        (e: Error) => active && setError(e.message),
      );
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data.isAdmin]);

  if (!data.isAdmin) {
    return (
      <section className="subpage">
        <section className="panel">
          <Lock style={{ marginBottom: 20 }} />
          <h2>{loaded ? "Administrator access required." : "Checking access…"}</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            This area is available only to the configured administrator account.
          </p>
        </section>
      </section>
    );
  }

  const count = (value: number) => units(value, "gems");

  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        ADMIN
      </div>
      <h1>House overview.</h1>
      <div className={tournamentStyles.tabs} role="group" aria-label="Admin sections">
        <button aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button aria-pressed={tab === "games"} onClick={() => setTab("games")}>
          Games
        </button>
        <button aria-pressed={tab === "tournaments"} onClick={() => setTab("tournaments")}>
          Tournaments
        </button>
        <button aria-pressed={tab === "race"} onClick={() => setTab("race")}>
          Weekly race
        </button>
        <button aria-pressed={tab === "anti-cheat"} onClick={() => setTab("anti-cheat")}>
          Anti-cheat
        </button>
        <button aria-pressed={tab === "players"} onClick={() => setTab("players")}>
          Players
        </button>
        <button aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>
          Reports
        </button>
        <button aria-pressed={tab === "partners"} onClick={() => setTab("partners")}>
          Partners
        </button>
        <button aria-pressed={tab === "security"} onClick={() => setTab("security")}>
          Security
        </button>
      </div>
      {tab === "security" ? <AdminSecurity /> : tab === "reports" ? <AdminReports /> : tab === "players" ? <AdminPeople /> : tab === "partners" ? <AdminPartners /> : tab === "anti-cheat" ? <AdminAntiCheat /> : tab === "race" ? <AdminRace /> : tab === "games" ? <AdminGames /> : tab === "tournaments" ? (
        <AdminTournaments solConfigured={!!data.launch?.configured} />
      ) : (
        <>
          <p className="muted">
            Live players, volumes and the devnet treasury. Refreshes every 15 seconds
            {overview && ` · updated ${new Date(overview.generated).toLocaleTimeString()}`}.
          </p>
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <h2 style={{ marginBottom: 4 }}>Players</h2>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="muted">Registered</span>
              <b>{overview ? count(overview.players.registered) : "—"}</b>
            </div>
            <div className="stat-card">
              <span className="muted">
                <span className="online-dot" /> Online now
              </span>
              <b className="lime">{overview ? count(overview.players.online) : "—"}</b>
            </div>
            <div className="stat-card">
              <span className="muted">Offline</span>
              <b>{overview ? count(overview.players.offline) : "—"}</b>
            </div>
          </div>
          {overview && overview.players.onlineNames.length > 0 && (
            <div className="online-list">
              {overview.players.onlineNames.map((p) => (
                <span key={p.name} className="online-chip">
                  <Avatar name={p.name} src={p.avatar} size={24} />
                  {p.name}
                </span>
              ))}
            </div>
          )}
          <p className="fine">Online means active in the last minute. Open pages check in every 15 seconds.</p>

          <AdminVolume overview={overview} />
          <AdminGrowth growth={overview?.growth} />

          <h2 style={{ marginTop: 35 }}>Treasury</h2>
          <FundedWallet treasury />
        </>
      )}
    </section>
  );
}
