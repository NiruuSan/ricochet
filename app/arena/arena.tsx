"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Gamepad2, HelpCircle, History, Trophy, Wallet, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STAKES } from "@/lib/api-types";
import { initials, sol } from "./format";
import { useGameSession } from "./use-game-session";
import type { View } from "./views";
import { usePlayerData } from "./use-player-data";
import { AdminView } from "./views/admin-view";
import { AuthView } from "./views/auth-view";
import { LeaderboardView } from "./views/leaderboard-view";
import { MatchesView } from "./views/matches-view";
import { PlayView, type Mode } from "./views/play-view";
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

type Modal = "" | "forfeit" | "demo-funds";

export default function Arena({ view }: { view: View }) {
  const player = usePlayerData();
  const { asset, setAsset, data, error, setError, refresh } = player;
  const onSaved = useCallback(() => void refresh(), [refresh]);
  const session = useGameSession({ onSaved, onError: setError });
  const [mode, setMode] = useState<Mode>("practice");
  const [stake, setStake] = useState<number>(STAKES[1]);
  const [modal, setModal] = useState<Modal>("");

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
    const run = await session.startMatch(stake, asset);
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
        </nav>
        <div className="top-actions">
          <span className="demo-tag">TEST MODE</span>
          {data.player ? (
            <>
              <Link className="balance-pill" href="/wallet">
                <Wallet />
                {sol(asset === "devnet" ? (data.cashBalance ?? 0) : data.player.balance)} {asset} SOL
              </Link>
              <Link className="avatar" href="/wallet" aria-label="Open wallet">
                {initials(data.player.name)}
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
            stake={stake}
            setStake={setStake}
            onStart={() => void start()}
            onForfeit={() => setModal("forfeit")}
          />
        )}
        {view === "welcome" && <WelcomeView session={session} />}
        {view === "matches" && <MatchesView player={player} />}
        {view === "leaderboard" && <LeaderboardView player={player} />}
        {view === "wallet" && <WalletView player={player} onDemoFundsInfo={() => setModal("demo-funds")} />}
        {(view === "login" || view === "signup") && <AuthView player={player} signup={view === "signup"} />}
        {(view === "faq" || view === "rules") && <RulesView rules={view === "rules"} />}
        {view === "admin" && <AdminView player={player} />}
        <footer className="foot">
          <span>© {new Date().getFullYear()} Ricochet · A good angle changes everything.</span>
          <div className="links">
            <Link href="/rules">Game rules</Link>
            <Link href="/faq">Q&A</Link>
            <Link href="/wallet">Test funds only</Link>
            {data.isAdmin && <Link href="/admin">Treasury</Link>}
          </div>
        </footer>
      </main>
      <Dialog open={!!modal} onOpenChange={(v) => !v && setModal("")}>
        <DialogContent className="dialog-dark">
          <DialogTitle>{modal === "forfeit" ? "Leave this match?" : "You’re playing with demo funds."}</DialogTitle>
          <DialogDescription>
            {modal === "forfeit"
              ? forfeitWarning
              : "Demo credits cannot be deposited or withdrawn. Each profile receives 20 free demo SOL. The separate devnet wallet supports test-network transfers when configured. Real SOL is not accepted."}
          </DialogDescription>
          <div className="row-actions" style={{ marginTop: 10 }}>
            {modal === "forfeit" ? (
              <>
                <button className="btn" onClick={() => setModal("")}>
                  Keep playing
                </button>
                <button
                  className="btn"
                  style={{ borderColor: "#ff8091", color: "#ffb2bf" }}
                  onClick={() => {
                    setModal("");
                    void session.forfeit();
                  }}
                >
                  Forfeit match
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setModal("")}>
                Got it <Check />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
