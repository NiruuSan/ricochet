"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Gamepad2, HelpCircle, History, Landmark, Trophy, Wallet, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STAKES } from "@/lib/api-types";
import { Avatar, GemIcon } from "./avatar";
import { units } from "./format";
import { useGameSession } from "./use-game-session";
import type { View } from "./views";
import { usePlayerData } from "./use-player-data";
import { AdminView } from "./views/admin-view";
import { AuthView } from "./views/auth-view";
import { LeaderboardView } from "./views/leaderboard-view";
import { MatchesView } from "./views/matches-view";
import { PlayView, type Mode } from "./views/play-view";
import { ProfileView } from "./views/profile-view";
import { RulesView } from "./views/rules-view";
import { WalletView } from "./views/wallet-view";
import { WelcomeView } from "./views/welcome-view";

export type PlayerState = ReturnType<typeof usePlayerData>;

const NAVIGATION = [
  { href: "/", view: "play", label: "Arena", Icon: Gamepad2 },
  { href: "/matches", view: "matches", label: "My matches", Icon: History },
  { href: "/leaderboard", view: "leaderboard", label: "Leaderboard", Icon: Trophy },
  { href: "/faq", view: "faq", label: "How to play", Icon: HelpCircle },
];

export default function Arena({ view }: { view: View }) {
  const player = usePlayerData();
  const { asset, setAsset, data, error, setError, refresh } = player;
  const onSaved = useCallback(() => void refresh(), [refresh]);
  const session = useGameSession({ onSaved, onError: setError });
  const [mode, setMode] = useState<Mode>("practice");
  // Each currency has its own five entries; the choice is kept by position.
  const [stakeIndex, setStakeIndex] = useState(1);
  const [confirmForfeit, setConfirmForfeit] = useState(false);

  // Load the player; on the arena, pick up a saved run where it was left.
  const { resume } = session;
  useEffect(() => {
    let current = true;
    void refresh().then((snapshot) => {
      if (!current || !snapshot?.active || view !== "play") return;
      resume(snapshot.active);
      setAsset(snapshot.active.asset);
      setMode("match");
    });
    return () => {
      current = false;
    };
  }, [refresh, resume, setAsset, view]);

  const start = async () => {
    setError("");
    if (mode === "practice") return session.startPractice();
    if (!data.player) {
      window.location.href = "/signup";
      return;
    }
    const run = await session.startMatch(STAKES[asset][stakeIndex], asset);
    if (run) setAsset(run.asset);
  };

  const currentMatch = data.matches.find((m) => m.id === session.run?.match_id);
  const forfeitWarning =
    currentMatch && !currentMatch.joined
      ? "Nobody has joined this match yet, so forfeiting closes it: no one can take the seat, and your entry is refunded minus the 12% house fee. This cannot be undone."
      : "Forfeiting ends your run. Your entry stays committed; an opponent who completes their run wins. If nobody has joined yet, the match closes and your entry is refunded minus the 12% house fee. This cannot be undone.";

  return (
    <>
      <header className="topbar">
        <Link href="/welcome" className="brand" aria-label="Ricochet home">
          <span className="brand-icon">
            <Zap fill="currentColor" />
          </span>
          ricochet<span className="lime">.</span>
        </Link>
        <nav className="navigation" aria-label="Main navigation">
          {NAVIGATION.map(({ href, view: key, label, Icon }) => (
            <Link key={key} href={href} className={view === key ? "active" : ""}>
              <Icon />
              {label}
            </Link>
          ))}
          {data.isAdmin && (
            <Link href="/admin" className={view === "admin" ? "active" : ""}>
              <Landmark />
              Admin
            </Link>
          )}
        </nav>
        <div className="top-actions">
          <span className="demo-tag">TEST MODE</span>
          {data.player ? (
            <>
              <Link className="balance-pill" href="/wallet" aria-label="Balances">
                <span className="pill-part">
                  <GemIcon />
                  {units(data.player.balance, "gems")}
                </span>
                {data.launch?.configured && (
                  <span className="pill-part">
                    <Wallet />
                    {units(data.cashBalance ?? 0, "devnet")} SOL
                  </span>
                )}
              </Link>
              <Link href="/profile" aria-label="Your profile" className="avatar-link">
                <Avatar name={data.player.name} src={data.player.avatar} />
              </Link>
            </>
          ) : (
            <Link className="btn" href="/login">
              Sign in <ArrowUpRight />
            </Link>
          )}
        </div>
      </header>
      <main className="shell">
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "play" && (
          <PlayView
            player={player}
            session={session}
            mode={mode}
            setMode={setMode}
            stakeIndex={stakeIndex}
            setStakeIndex={setStakeIndex}
            onStart={() => void start()}
            onForfeit={() => setConfirmForfeit(true)}
          />
        )}
        {view === "welcome" && <WelcomeView session={session} />}
        {view === "matches" && <MatchesView player={player} />}
        {view === "leaderboard" && <LeaderboardView player={player} />}
        {view === "wallet" && <WalletView player={player} />}
        {view === "profile" && <ProfileView player={player} />}
        {(view === "login" || view === "signup") && <AuthView player={player} signup={view === "signup"} />}
        {(view === "faq" || view === "rules") && <RulesView rules={view === "rules"} />}
        {view === "admin" && <AdminView player={player} />}
        <footer className="foot">
          <span>© {new Date().getFullYear()} Ricochet · A good angle changes everything.</span>
          <div className="links">
            <Link href="/rules">Game rules</Link>
            <Link href="/faq">Q&A</Link>
            <Link href="/wallet">Test funds only</Link>
          </div>
        </footer>
      </main>
      <Dialog open={confirmForfeit} onOpenChange={setConfirmForfeit}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Leave this match?</DialogTitle>
          <DialogDescription>{forfeitWarning}</DialogDescription>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setConfirmForfeit(false)}>
              Keep playing
            </button>
            <button
              className="btn"
              style={{ borderColor: "#ff8091", color: "#ffb2bf" }}
              onClick={() => {
                setConfirmForfeit(false);
                void session.forfeit();
              }}
            >
              Forfeit match
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
