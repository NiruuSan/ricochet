"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bug, Gamepad2, HelpCircle, Landmark, LogOut, Medal, Palette, Radio, Target, Trophy, UserRound, Users, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { signOutToLogin } from "../auth-actions";
import { Avatar, GemIcon } from "./avatar";
import { RankBadge } from "./rank-badge";
import { CurrencyMenu, useMoney } from "./currency-menu";
import { startMoney } from "./money";
import { units } from "./format";
import { Notifications } from "./notifications";
import { FeedbackHost, RollingBalance, useArrival } from "./feedback";
import feedback from "./feedback.module.css";
import { SuspensionNotice } from "./suspension-notice";
import { InAppNotice } from "./in-app-notice";
import { CookieBanner } from "./cookie-banner";
import { rememberReferral } from "./referral-link";
import { useGameSession } from "./use-game-session";
import type { View } from "./views";
import { usePlayerData } from "./use-player-data";
import { themeById } from "./theme";
// Each page only downloads the view it shows; the others load when you navigate to them.
const AdminView = dynamic(() => import("./views/admin-view").then((m) => m.AdminView));
const BugReportDialog = dynamic(() => import("./bug-report-dialog").then((m) => m.BugReportDialog));
// Only the administrator ever downloads the code prompt for administrator changes.
const AdminConfirm = dynamic(() => import("./admin-confirm").then((m) => m.AdminConfirm));
const AdminCaseView = dynamic(() => import("./views/admin-case-view").then((m) => m.AdminCaseView));
const AuthView = dynamic(() => import("./views/auth-view").then((m) => m.AuthView));
const LeaderboardView = dynamic(() => import("./views/leaderboard-view").then((m) => m.LeaderboardView));
const LiveView = dynamic(() => import("./views/live-view").then((m) => m.LiveView));
const MatchesView = dynamic(() => import("./views/matches-view").then((m) => m.MatchesView));
const PlayView = dynamic(() => import("./views/play-view").then((m) => m.PlayView));
const ProfileView = dynamic(() => import("./views/profile-view").then((m) => m.ProfileView));
const PrivacyView = dynamic(() => import("./views/privacy-view").then((m) => m.PrivacyView));
const TermsView = dynamic(() => import("./views/terms-view").then((m) => m.TermsView));
const FriendsView = dynamic(() => import("./views/friends-view").then((m) => m.FriendsView));
const QuestsView = dynamic(() => import("./views/quests-view").then((m) => m.QuestsView));
const ThemesView = dynamic(() => import("./views/themes-view").then((m) => m.ThemesView));
const PublicProfileView = dynamic(() => import("./views/public-profile-view").then((m) => m.PublicProfileView));
const RulesView = dynamic(() => import("./views/rules-view").then((m) => m.RulesView));
const TournamentDetailView = dynamic(() => import("./views/tournament-detail-view").then((m) => m.TournamentDetailView));
const TournamentsView = dynamic(() => import("./views/tournaments-view").then((m) => m.TournamentsView));
const WatchView = dynamic(() => import("./views/watch-view").then((m) => m.WatchView));
const WalletView = dynamic(() => import("./views/wallet-view").then((m) => m.WalletView));
const WelcomeView = dynamic(() => import("./views/welcome-view").then((m) => m.WelcomeView));

export type PlayerState = ReturnType<typeof usePlayerData>;

/** The gems in the top bar: where claimed gems fly, counting up as they land. */
function GemBalance({ value }: { value: number }) {
  const landing = useArrival("gems");
  return (
    <Link className={`pill-part ${landing ? feedback.pulse : ""}`} href="/wallet" aria-label="Your gems" data-balance="gems">
      <GemIcon />
      <RollingBalance asset="gems" value={value} format={(n) => units(n, "gems")} />
    </Link>
  );
}

/**
 * On a computer the board is played at its full size, so a short window
 * scrolls instead of shrinking it: the game is brought to the middle of the
 * window when it fits there, and otherwise the bottom of the board is — where
 * the ball leaves from, with the sound and speed controls. A window tall
 * enough for the page as it is stays at the top. On a phone or a tablet the
 * board already plays full screen (globals.css).
 */
function centerTheBoard() {
  if (!window.matchMedia("(min-width: 1025px)").matches) return;
  const game = document.querySelector(".game-screen");
  const frame = game?.querySelector(".board-shell");
  if (!game || !frame) return;
  const margin = 12;
  const top = game.getBoundingClientRect().top + window.scrollY;
  const bottom = frame.getBoundingClientRect().bottom + window.scrollY;
  const room = window.innerHeight;
  const target = bottom + margin <= room ? 0 : bottom - top + 2 * margin <= room ? top - (room - (bottom - top)) / 2 : bottom + margin - room;
  window.scrollTo({ top: Math.max(0, Math.round(target)), behavior: "instant" });
}

// `short` is what the phone tab bar shows under each icon.
const NAVIGATION = [
  { href: "/", view: "play", label: "Arena", short: "Arena", Icon: Gamepad2 },
  { href: "/live", view: "live", label: "Live", short: "Live", Icon: Radio },
  { href: "/tournaments", view: "tournaments", label: "Tournaments", short: "Cups", Icon: Medal },
  { href: "/leaderboard", view: "leaderboard", label: "Leaderboard", short: "Ranks", Icon: Trophy },
  { href: "/rules", view: "rules", label: "How to play", short: "Help", Icon: HelpCircle },
];

type ArenaProps = { view: View; profileName?: string; adminCaseName?: string; initialMatchId?: string; initialTournamentId?: string; initialInvite?: string; tournamentId?: string; watchId?: string };

export default function Arena({ view, profileName, adminCaseName, initialMatchId, initialTournamentId, initialInvite, tournamentId, watchId }: ArenaProps) {
  const player = usePlayerData();
  // Reading the stored choice happens after mounting, so the first paint still
  // matches the HTML the server sent; from then on every amount follows it.
  useMoney();
  useEffect(() => startMoney(), []);
  // A shared replay or score carries its sharer's referral code: keep it for sign-up, whatever page it opened.
  useEffect(() => rememberReferral(new URLSearchParams(window.location.search).get("ref")), []);
  const { asset, setAsset, data, error, setError, refresh } = player;
  const onSaved = useCallback(() => void refresh(), [refresh]);
  // The skin the player wears follows them onto the board and its screens.
  const theme = themeById(data.theme);
  const session = useGameSession({ onSaved, onError: setError, theme });
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [reportBug, setReportBug] = useState(false);
  const router = useRouter();
  // A match recap opened from a notification or a `/?match=<id>` link.
  const [recapMatchId, setRecapState] = useState<string | null>(view === "play" ? (initialMatchId ?? null) : null);

  const [playTournamentId, setPlayTournamentId] = useState<string | null>(view === "play" ? (initialTournamentId ?? null) : null);
  // A challenge link: the seat is taken once, then the address goes back to the arena.
  const [invite, setInvite] = useState<string | null>(view === "play" ? (initialInvite ?? null) : null);
  const clearInvite = useCallback(() => {
    setInvite(null);
    if (window.location.search.includes("join=")) window.history.replaceState(null, "", "/");
  }, []);
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

  // Requests to answer and messages to read, shown on the account menu.
  const friendAlerts = (data.friends?.requests ?? 0) + (data.friends?.unread ?? 0);
  const questsReady = data.questsReady ?? 0;

  // A board on a phone or a tablet plays full screen: the stylesheet hides the
  // chrome around it while this class is on the body.
  const playing = view === "play" && session.started;
  useEffect(() => {
    document.body.classList.toggle("playing", playing);
    if (!playing) return () => document.body.classList.remove("playing");
    // The board takes the lobby's place, at its full size: bring it to the
    // middle of the window now and whenever the window changes size.
    let frame = requestAnimationFrame(centerTheBoard);
    const recenter = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(centerTheBoard);
    };
    window.addEventListener("resize", recenter);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", recenter);
      document.body.classList.remove("playing");
    };
  }, [playing]);

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
          {/* The narrowest phones get the mark alone, so the account's buttons keep their room. */}
          <picture>
            <source media="(max-width: 400px)" srcSet="/brand/bounce-icon-rotated.svg" />
            <img src="/brand/bounce-white.svg" alt="Bounce" width={147} height={36} />
          </picture>
        </Link>
        <nav className="navigation" aria-label="Main navigation">
          {NAVIGATION.map(({ href, view: key, label, short, Icon }) => (
            <Link key={key} href={href} className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined}>
              <Icon />
              <span className="nav-label">{label}</span>
              <span className="nav-label-short">{short}</span>
            </Link>
          ))}
          {data.isAdmin && (
            <Link href="/admin" className={view === "admin" ? "active" : ""}>
              <Landmark />
              <span className="nav-label">Admin</span>
              <span className="nav-label-short">Admin</span>
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
              <span className="balance-pill">
                {data.launch?.configured && <CurrencyMenu lamports={data.cashBalance ?? 0} />}
                <GemBalance value={data.player.balance} />
              </span>
              {/* The account menu: where the profile, the wallet and the way out live. */}
              {/* The rank is the one mark of standing that has to be played
                  for, so it travels with the avatar on every page. */}
              <RankBadge rank={data.player.ranked} className="top-rank" />
              <Menu
                label="Your account"
                triggerClassName="avatar-link"
                trigger={
                  // Where money flies when the balance pill is hidden on a narrow screen.
                  <span data-balance-fallback>
                    <Avatar name={data.player.name} src={data.player.avatar} />
                  </span>
                }
                items={[
                  { label: "Your profile", href: "/profile", icon: <UserRound /> },
                  { label: friendAlerts ? `Friends · ${friendAlerts}` : "Friends", href: "/friends", icon: <Users /> },
                  { label: questsReady ? `Quests · ${questsReady}` : "Quests", href: "/quests", icon: <Target /> },
                  { label: "Themes", href: "/themes", icon: <Palette /> },
                  { label: "Wallet", href: "/wallet", icon: <Wallet /> },
                  { label: "Report a bug", onSelect: () => setReportBug(true), icon: <Bug /> },
                  { label: "Sign out", onSelect: () => void signOutToLogin(), icon: <LogOut />, danger: true, separated: true },
                ]}
              />
            </>
          ) : (
            <Link className="btn" href="/login">
              Sign in <ArrowUpRight />
            </Link>
          )}
        </div>
      </header>
      <main className="shell">
        {data.suspension && <SuspensionNotice player={player} />}
        {/* The sign-in page has its own, firmer version; a board being played is left alone. */}
        {view !== "login" && view !== "signup" && !playing && <InAppNotice />}
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
            invite={invite}
            clearInvite={clearInvite}
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
        {view === "rules" && <RulesView />}
        {view === "privacy" && <PrivacyView />}
        {view === "terms" && <TermsView />}
        {view === "friends" && <FriendsView player={player} />}
        {view === "quests" && <QuestsView player={player} />}
        {view === "themes" && <ThemesView player={player} />}
        {view === "admin" && (adminCaseName ? <AdminCaseView key={adminCaseName} name={adminCaseName} player={player} /> : <AdminView player={player} />)}
        <footer className="foot">
          <span>© {new Date().getFullYear()} Bounce · A good angle changes everything.</span>
          <div className="links" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/rules">Game rules</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/privacy#cookies">Cookies</Link>
            <button className="btn" onClick={() => setReportBug(true)}><Bug size={16} /> Report a bug</button>
            <Link href="/wallet">Test funds only</Link>
          </div>
        </footer>
      </main>
      <FeedbackHost />
      <CookieBanner />
      {data.isAdmin && <AdminConfirm />}
      <BugReportDialog open={reportBug} onOpenChange={setReportBug} signedIn={!!data.authenticated} hasProfile={!!data.player} />
      <Dialog open={confirmForfeit} onOpenChange={setConfirmForfeit}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Leave this match?</DialogTitle>
          <DialogDescription>{forfeitWarning}</DialogDescription>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setConfirmForfeit(false)}>
              Keep playing
            </button>
            <button
              className="btn btn-danger"
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
