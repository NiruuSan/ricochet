"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Gamepad2, HelpCircle, Landmark, Medal, Radio, Trophy, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, GemIcon } from "./avatar";
import { units } from "./format";
import { Notifications } from "./notifications";
import { useGameSession } from "./use-game-session";
import type { View } from "./views";
import { usePlayerData } from "./use-player-data";
// Each page only downloads the view it shows; the others load when you navigate to them.
const AdminView = dynamic(() => import("./views/admin-view").then((m) => m.AdminView));
const AuthView = dynamic(() => import("./views/auth-view").then((m) => m.AuthView));
const LeaderboardView = dynamic(() => import("./views/leaderboard-view").then((m) => m.LeaderboardView));
const LiveView = dynamic(() => import("./views/live-view").then((m) => m.LiveView));
const MatchesView = dynamic(() => import("./views/matches-view").then((m) => m.MatchesView));
const PlayView = dynamic(() => import("./views/play-view").then((m) => m.PlayView));
const ProfileView = dynamic(() => import("./views/profile-view").then((m) => m.ProfileView));
const PublicProfileView = dynamic(() => import("./views/public-profile-view").then((m) => m.PublicProfileView));
const RulesView = dynamic(() => import("./views/rules-view").then((m) => m.RulesView));
const TournamentDetailView = dynamic(() => import("./views/tournament-detail-view").then((m) => m.TournamentDetailView));
const TournamentsView = dynamic(() => import("./views/tournaments-view").then((m) => m.TournamentsView));
const WatchView = dynamic(() => import("./views/watch-view").then((m) => m.WatchView));
const WalletView = dynamic(() => import("./views/wallet-view").then((m) => m.WalletView));
const WelcomeView = dynamic(() => import("./views/welcome-view").then((m) => m.WelcomeView));

export type PlayerState = ReturnType<typeof usePlayerData>;

const NAVIGATION = [
  { href: "/", view: "play", label: "Arena", Icon: Gamepad2 },
  { href: "/live", view: "live", label: "Live", Icon: Radio },
  { href: "/tournaments", view: "tournaments", label: "Tournaments", Icon: Medal },
  { href: "/leaderboard", view: "leaderboard", label: "Leaderboard", Icon: Trophy },
  { href: "/faq", view: "faq", label: "How to play", Icon: HelpCircle },
];

type ArenaProps = { view: View; profileName?: string; initialMatchId?: string; initialTournamentId?: string; tournamentId?: string; watchId?: string };

export default function Arena({ view, profileName, initialMatchId, initialTournamentId, tournamentId, watchId }: ArenaProps) {
  const player = usePlayerData();
  const { asset, setAsset, data, error, setError, refresh } = player;
  const onSaved = useCallback(() => void refresh(), [refresh]);
  const session = useGameSession({ onSaved, onError: setError });
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const router = useRouter();
  // A match recap opened from a notification or a `/?match=<id>` link.
  const [recapMatchId, setRecapState] = useState<string | null>(view === "play" ? (initialMatchId ?? null) : null);

  const [playTournamentId, setPlayTournamentId] = useState<string | null>(view === "play" ? (initialTournamentId ?? null) : null);
  const clearTournament = useCallback(() => {
    setPlayTournamentId(null);
    if (window.location.search.includes("tournament=")) window.history.replaceState(null, "", "/");
  }, []);

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
      // A tournament link takes over the board; a 1v1 run resumes next time.
      if (!current || !snapshot?.active || view !== "play" || initialTournamentId) return;
      resume(snapshot.active);
      setAsset(snapshot.active.asset);
    });
    return () => {
      current = false;
    };
  }, [initialTournamentId, refresh, resume, setAsset, view]);

  const currentMatch = data.matches.find((m) => m.id === session.run?.match_id);
  const refundDescription = (session.run?.asset ?? asset) === "gems" ? "refunded in full" : "refunded minus the 12% house fee";
  // Matches created before ruleset 4 keep the forfeit rules they started with.
  const forfeitWarning = session.run?.tournamentId
    ? `Ending your run now locks your score of ${session.game.score.toLocaleString("en")} for this tournament. You only get one run. This cannot be undone.`
    : (session.run?.ruleset ?? 4) >= 4
      ? `Forfeiting ends your run now with your current score of ${session.game.score.toLocaleString("en")}. Your entry stays in the match: ${
          currentMatch?.joined ? "your opponent wins if they finish with a higher score" : "the seat stays open, and whoever joins wins the pot by beating your score"
        }. This cannot be undone.`
      : currentMatch && !currentMatch.joined
        ? `Nobody has joined this match yet, so forfeiting closes it: no one can take the seat, and your entry is ${refundDescription}. This cannot be undone.`
        : `Forfeiting ends your run. Your entry stays committed; an opponent who completes their run wins. This cannot be undone.`;

  return (
    <>
      <header className="topbar">
        <Link href="/welcome" className="brand" aria-label="Bounce home">
          <img src="/brand/bounce-white.svg" alt="Bounce" width={147} height={36} />
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
                {data.launch?.configured && (
                  <span className="pill-part pill-sol">
                    <Wallet />
                    {units(data.cashBalance ?? 0, "devnet")} SOL
                  </span>
                )}
                <span className="pill-part">
                  <GemIcon />
                  {units(data.player.balance, "gems")}
                </span>
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
        {data.suspension && (
          <div className="error" role="alert">
            <span>
              <b>Your account is suspended.</b> {data.suspension.reason}. Play, withdrawals and tips are paused while this is reviewed. Contact support if you think this is a mistake.
            </span>
          </div>
        )}
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
            tournamentId={playTournamentId}
            clearTournament={clearTournament}
          />
        )}
        {view === "tournaments" && (tournamentId ? <TournamentDetailView key={tournamentId} id={tournamentId} player={player} /> : <TournamentsView player={player} />)}
        {view === "watch" && watchId && <WatchView key={watchId} id={watchId} />}
        {view === "welcome" && <WelcomeView session={session} />}
        {view === "matches" && <MatchesView player={player} />}
        {view === "live" && <LiveView />}
        {view === "leaderboard" && <LeaderboardView player={player} />}
        {view === "wallet" && <WalletView player={player} />}
        {view === "profile" && (profileName ? <PublicProfileView key={profileName} name={profileName} player={player} /> : <ProfileView player={player} />)}
        {(view === "login" || view === "signup") && <AuthView player={player} signup={view === "signup"} />}
        {(view === "faq" || view === "rules") && <RulesView rules={view === "rules"} />}
        {view === "admin" && <AdminView player={player} />}
        <footer className="foot">
          <span>© {new Date().getFullYear()} Bounce · A good angle changes everything.</span>
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
