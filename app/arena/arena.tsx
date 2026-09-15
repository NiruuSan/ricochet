"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Gamepad2, HelpCircle, History, Landmark, Trophy, Wallet, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, GemIcon } from "./avatar";
import { units } from "./format";
import { Notifications } from "./notifications";
import { useGameSession } from "./use-game-session";
import type { View } from "./views";
import { usePlayerData } from "./use-player-data";
import { AdminView } from "./views/admin-view";
import { AuthView } from "./views/auth-view";
import { LeaderboardView } from "./views/leaderboard-view";
import { MatchesView } from "./views/matches-view";
import { PlayView } from "./views/play-view";
import { ProfileView } from "./views/profile-view";
import { PublicProfileView } from "./views/public-profile-view";
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

export default function Arena({ view, profileName, initialMatchId }: { view: View; profileName?: string; initialMatchId?: string }) {
  const player = usePlayerData();
  const { asset, setAsset, data, error, setError, refresh } = player;
  const onSaved = useCallback(() => void refresh(), [refresh]);
  const session = useGameSession({ onSaved, onError: setError });
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const router = useRouter();
  // A match recap opened from a notification or a `/?match=<id>` link.
  const [recapMatchId, setRecapState] = useState<string | null>(view === "play" ? (initialMatchId ?? null) : null);

  const setRecapMatchId = useCallback((id: string | null) => {
    setRecapState(id);
    if (!id && window.location.search.includes("match=")) window.history.replaceState(null, "", "/");
  }, []);

  const openMatch = useCallback(
    (id: string) => {
      if (view === "play") setRecapMatchId(id);
      else router.push(`/?match=${encodeURIComponent(id)}`);
    },
    [router, setRecapMatchId, view],
  );
  const viewingMatchId = recapMatchId ?? (session.started && session.game.over ? (session.run?.match_id ?? null) : null);

  // Load the player; on the arena, pick up a saved run where it was left.
  const { resume } = session;
  useEffect(() => {
    let current = true;
    void refresh().then((snapshot) => {
      if (!current || !snapshot?.active || view !== "play") return;
      resume(snapshot.active);
      setAsset(snapshot.active.asset);
    });
    return () => {
      current = false;
    };
  }, [refresh, resume, setAsset, view]);

  const currentMatch = data.matches.find((m) => m.id === session.run?.match_id);
  const refundDescription = (session.run?.asset ?? asset) === "gems" ? "refunded in full" : "refunded minus the 12% house fee";
  // Matches created before ruleset 4 keep the forfeit rules they started with.
  const forfeitWarning =
    (session.run?.ruleset ?? 4) >= 4
      ? `Forfeiting ends your run now with your current score of ${session.game.score.toLocaleString("en")}. Your entry stays in the match: ${
          currentMatch?.joined ? "your opponent wins if they finish with a higher score" : "the seat stays open, and whoever joins wins the pot by beating your score"
        }. This cannot be undone.`
      : currentMatch && !currentMatch.joined
        ? `Nobody has joined this match yet, so forfeiting closes it: no one can take the seat, and your entry is ${refundDescription}. This cannot be undone.`
        : `Forfeiting ends your run. Your entry stays committed; an opponent who completes their run wins. This cannot be undone.`;

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
              <Notifications
                items={data.notifications}
                unread={data.unreadNotifications ?? 0}
                onOpenMatch={openMatch}
                onRead={onSaved}
                viewingMatchId={viewingMatchId}
              />
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
            onForfeit={() => setConfirmForfeit(true)}
            recapMatchId={recapMatchId}
            setRecapMatchId={setRecapMatchId}
          />
        )}
        {view === "welcome" && <WelcomeView session={session} />}
        {view === "matches" && <MatchesView player={player} />}
        {view === "leaderboard" && <LeaderboardView player={player} />}
        {view === "wallet" && <WalletView player={player} />}
        {view === "profile" && (profileName ? <PublicProfileView key={profileName} name={profileName} player={player} /> : <ProfileView player={player} />)}
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
