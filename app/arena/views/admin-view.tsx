"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Banknote, Bot, Bug, Flag, Gamepad2, Gauge, Handshake, Lock, ShieldAlert, ShieldCheck, Trophy, Users, Zap, type LucideIcon } from "lucide-react";
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
import { AdminBots } from "./admin-bots";
import { AdminBugReports } from "./admin-bug-reports";
import { AdminRace } from "./admin-race";
import { AdminTournaments } from "./admin-tournaments";
import { AdminSecurity } from "./admin-security";
import { AdminVolume } from "./volume-chart";
import { AdminGrowth } from "./admin-growth";
import styles from "./admin.module.css";

const REFRESH_MS = 15_000;
const noSubscription = () => () => {};

/**
 * Every tool in the house, named once.
 *
 * The rail, the page title and the line under it all come from this table, so a
 * tab only has to render its own contents: no tab repeats its own heading, and
 * no two of them describe themselves differently.
 */
type Queue = keyof AdminOverview["queues"];
type Section = { label: string; icon: LucideIcon; title: string; blurb: string; queue?: Queue };
const SECTIONS = {
  overview: { label: "Overview", icon: Gauge, title: "House overview", blurb: "Who is here, what is being wagered, and how many of them come back. Refreshes every 15 seconds." },
  treasury: { label: "Treasury", icon: Banknote, title: "Treasury", blurb: "The house wallet: what it holds, what it owes, and the way money comes in and goes out." },
  bots: { label: "House players", icon: Bot, title: "House players", blurb: "The players the house sits at the tables while the site fills up, and the button that retires them at launch." },
  games: { label: "Games", icon: Gamepad2, title: "Games in progress", blurb: "Every 1v1 match that has not settled, most recently played first. Tournament runs are ended from Tournaments.", queue: "games" },
  tournaments: { label: "Tournaments", icon: Trophy, title: "Tournaments", blurb: "Schedule a cup, watch it fill, end it early or refund it." },
  race: { label: "Weekly race", icon: Zap, title: "Weekly race", blurb: "The best single score of the week, what each place pays, and the button that pays it." },
  "anti-cheat": { label: "Anti-cheat", icon: ShieldAlert, title: "Anti-cheat", blurb: "Suspensions, the players worth a look, and every signal the game recorded.", queue: "cases" },
  reports: { label: "Reports", icon: Flag, title: "Player reports", blurb: "What players have said about each other. Suspensions are still made from Anti-cheat.", queue: "reports" },
  security: { label: "Security", icon: ShieldCheck, title: "Account security", blurb: "Help a player who lost their authenticator and recovery codes. Verify who they are outside Bounce first." },
  players: { label: "Players", icon: Users, title: "Players", blurb: "Every profile on the site, newest first, and the development tools that reset or remove one." },
  partners: { label: "Partners", icon: Handshake, title: "Referrals & partners", blurb: "Who brings players in, what their code is worth to them, and what it leaves the house." },
  bugs: { label: "Bug reports", icon: Bug, title: "Bug reports", blurb: "Problems reported by players, newest first. Resolved reports stay in the inbox.", queue: "bugs" },
} satisfies Record<string, Section>;
type TabKey = keyof typeof SECTIONS;

const GROUPS: { name: string; tabs: TabKey[] }[] = [
  { name: "House", tabs: ["overview", "treasury", "bots"] },
  { name: "Play", tabs: ["games", "tournaments", "race"] },
  { name: "Integrity", tabs: ["anti-cheat", "reports", "security"] },
  { name: "People", tabs: ["players", "partners", "bugs"] },
];

export function AdminView({ player }: { player: PlayerState }) {
  const { data, loaded } = player;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const requestedReview = useSyncExternalStore(noSubscription, () => new URLSearchParams(window.location.search).get("tab") === "anti-cheat", () => false);
  const [chosenTab, setTab] = useState<TabKey | null>(null);
  const tab: TabKey = chosenTab ?? (requestedReview ? "anti-cheat" : "overview");

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

  const section = SECTIONS[tab];
  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div>
          <span className={styles.eyebrow}>
            <ShieldCheck size={13} /> Admin
          </span>
          <h1>{section.title}</h1>
          <p>{section.blurb}</p>
        </div>
        {overview && <span className={styles.live}>Live · updated {new Date(overview.generated).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
      </header>

      <div className={styles.shell}>
        <nav className={styles.rail} aria-label="Admin sections">
          {GROUPS.map((group) => (
            <div key={group.name} className={styles.railGroup}>
              <span>{group.name}</span>
              {group.tabs.map((key) => {
                const item = SECTIONS[key] as Section;
                const waiting = item.queue && overview ? overview.queues[item.queue] : 0;
                return (
                  <button key={key} className={styles.railItem} aria-current={tab === key} onClick={() => setTab(key)}>
                    <item.icon size={16} />
                    {item.label}
                    {waiting > 0 && <span className={`${styles.count} ${key === "games" ? styles.countQuiet : ""}`}>{waiting}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div>
          {error && tab === "overview" && (
            <div className="error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {tab === "overview" ? (
            <HouseOverview overview={overview} />
          ) : tab === "treasury" ? (
            <FundedWallet treasury />
          ) : tab === "bots" ? (
            <AdminBots />
          ) : tab === "games" ? (
            <AdminGames />
          ) : tab === "tournaments" ? (
            <AdminTournaments solConfigured={!!data.launch?.configured} />
          ) : tab === "race" ? (
            <AdminRace />
          ) : tab === "anti-cheat" ? (
            <AdminAntiCheat />
          ) : tab === "reports" ? (
            <AdminReports />
          ) : tab === "security" ? (
            <AdminSecurity />
          ) : tab === "players" ? (
            <AdminPeople />
          ) : tab === "partners" ? (
            <AdminPartners />
          ) : (
            <AdminBugReports />
          )}
        </div>
      </div>
    </section>
  );
}

/** Who is on the site, what they wagered, and whether they came back. */
function HouseOverview({ overview }: { overview: AdminOverview | null }) {
  const count = (value: number) => units(value, "gems");
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            Players {overview && <small>· {count(overview.players.registered)} registered</small>}
          </h2>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span>Registered</span>
            <b>{overview ? count(overview.players.registered) : "—"}</b>
          </div>
          <div className={styles.stat}>
            <span>
              <span className="online-dot" /> Online now
            </span>
            <b className="lime">{overview ? count(overview.players.online) : "—"}</b>
            <small>Active in the last minute</small>
          </div>
          <div className={styles.stat}>
            <span>Offline</span>
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
      </section>

      <AdminVolume overview={overview} />
      <AdminGrowth growth={overview?.growth} />
    </>
  );
}
