"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Gamepad2, HelpCircle, History, Play, RotateCcw, ShieldCheck, Target, UserRound, Zap } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STAKES, type Asset } from "@/lib/api-types";
import { MAX_ANGLE, MIN_ANGLE } from "@/lib/engine";
import { Board } from "../board";
import { HOW_TO_STEPS } from "../content";
import { initials, outcome, shortId, sol } from "../format";
import type { GameSession } from "../use-game-session";
import type { PlayerState } from "../arena";

export type Mode = "practice" | "match";

type Props = {
  player: PlayerState;
  session: GameSession;
  mode: Mode;
  setMode: (mode: Mode) => void;
  stake: number;
  setStake: (stake: number) => void;
  onStart: () => void;
  onForfeit: () => void;
};

export function PlayView({ player, session, mode, setMode, stake, setStake, onStart, onForfeit }: Props) {
  const { data, asset, setAsset } = player;
  const { game, run, started, flying, saving, angle } = session;
  const inProgress = started && !game.over;
  const devnetUnavailable = mode === "match" && asset === "devnet" && !data.launch?.configured;
  const currentMatch = data.matches.find((m) => m.id === run?.match_id);
  const entryLabel = mode === "practice" ? "Let’s play" : asset === "devnet" ? "Enter devnet match" : "Enter demo match";

  return (
    <>
      <div className="page-intro">
        <div>
          <div className="tag">THE BRICK-BREAKER ARENA</div>
          <h1>
            Good angles. <span className="lime">Great games.</span>
          </h1>
          <p>Same seed. Same chances. Make every bounce count.</p>
        </div>
        <Link href="/rules" className="btn">
          <HelpCircle />
          Game rules
        </Link>
      </div>
      <div className="arena-layout">
        <aside className="left-rail">
          <section className="panel">
            <div className="panel-title">
              <h2>Your next match</h2>
              <Gamepad2 />
            </div>
            <Tabs value={mode} onValueChange={(m) => !inProgress && setMode(m as Mode)}>
              <TabsList className="mode-tabs">
                <TabsTrigger value="practice" disabled={inProgress}>
                  Practice
                </TabsTrigger>
                <TabsTrigger value="match" disabled={inProgress}>
                  1v1 match
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div style={{ marginTop: 12 }}>
              <Tabs value={asset} onValueChange={(v) => !inProgress && setAsset(v as Asset)}>
                <TabsList className="mode-tabs">
                  <TabsTrigger value="demo" disabled={inProgress}>
                    Demo credits
                  </TabsTrigger>
                  <TabsTrigger value="devnet" disabled={inProgress}>
                    Devnet SOL
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {asset === "devnet" && (
              <p className="fine" style={{ marginTop: 10 }}>
                Test-network SOL · {sol(data.cashBalance ?? 0)} available. {!data.launch?.configured && "Funding is not connected yet. "}
                <Link href="/wallet" className="lime">
                  Fund wallet
                </Link>
              </p>
            )}
            <p className="tag muted" style={{ marginTop: 24, letterSpacing: 1 }}>
              CHOOSE YOUR ENTRY
            </p>
            <div className="stake-grid">
              {STAKES.map((s) => (
                <button
                  className={`stake ${s === stake ? "selected" : ""}`}
                  aria-pressed={s === stake}
                  disabled={inProgress}
                  key={s}
                  onClick={() => {
                    setStake(s);
                    setMode("match");
                  }}
                >
                  {sol(s)} <span style={{ fontSize: 11 }}>SOL</span>
                </button>
              ))}
            </div>
            <div className="math-line">
              <span>Your entry</span>
              <strong>{mode === "practice" ? "Free" : `${sol(stake)} SOL`}</strong>
            </div>
            <div className="math-line">
              <span>House fee · 12% each</span>
              <strong>{mode === "practice" ? "None" : `${sol((stake * 12) / 100)} SOL`}</strong>
            </div>
            <div className="prize">
              <span style={{ fontSize: 14 }}>{mode === "practice" ? "Play to improve" : "Winner receives"}</span>
              <b>{mode === "practice" ? "∞ retries" : `${sol((stake * 176) / 100)} SOL`}</b>
            </div>
            <button className="btn btn-primary full" disabled={saving || flying || inProgress || devnetUnavailable} onClick={onStart}>
              {saving ? "Saving…" : inProgress ? "Your run is in progress" : entryLabel}
              <ArrowRight />
            </button>
            <div className="status-strip">
              <ShieldCheck />{" "}
              {mode === "practice" ? "No entry. No wallet. Just play." : asset === "devnet" ? "Devnet test SOL · no real money" : "Demo funds only · no real money"}
            </div>
          </section>
          <section className="panel">
            <div className="panel-title" style={{ marginBottom: 8 }}>
              <h3>A little skill goes a long way</h3>
              <Target />
            </div>
            {HOW_TO_STEPS.map(([title, description], i) => (
              <div className="how-step" key={title}>
                <span className="num">0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </section>
        </aside>

        <section className="board-column">
          <Board
            session={session}
            onStart={onStart}
            startDisabled={saving || devnetUnavailable}
            startLabel={mode === "practice" ? "Play for free" : entryLabel}
          />
          <div className="aim-controls">
            <button className="btn" aria-label="Aim more left" disabled={flying || saving} onClick={() => session.setAngle((a) => Math.min(MAX_ANGLE, a + 3))}>
              <ChevronLeft />
            </button>
            <output>{Math.round(angle)}°</output>
            <button className="btn" aria-label="Aim more right" disabled={flying || saving} onClick={() => session.setAngle((a) => Math.max(MIN_ANGLE, a - 3))}>
              <ChevronRight />
            </button>
            <button className="btn" disabled={!inProgress || flying || saving} onClick={session.shoot}>
              <Play size={14} />
              Launch
            </button>
            {inProgress && (
              <button
                className="icon-btn"
                onClick={run ? onForfeit : session.reset}
                disabled={!!run && (flying || saving)}
                aria-label={run ? "Forfeit match" : "Reset practice"}
              >
                <RotateCcw size={17} />
              </button>
            )}
          </div>
          {game.bonus && <p className="round-banner">Board cleared! +4 bonus balls +1 round ball.</p>}
          <div className="callout">
            <Zap />
            <div>
              <h3>Clear the board. Bring more bounce.</h3>
              <p>Destroy every brick to collect 4 bonus balls.</p>
            </div>
          </div>
        </section>

        <aside className="right-rail">
          <section className="panel">
            <div className="panel-title">
              <h3>{run ? "Your matchup" : "The matchup"}</h3>
              <span className="demo-tag">{run ? "1V1" : "ASYNC"}</span>
            </div>
            <div className="rival">
              <div className="rival-icon">
                <UserRound />
              </div>
              <b>{currentMatch?.opponent ?? "Your next challenger"}</b>
              <p>{currentMatch?.opponent ? "Same seed. Their score stays hidden." : "Play now. Match when they arrive."}</p>
            </div>
            <div className="vs-line">VS</div>
            <div className="you-card">
              <span className="avatar">{data.player ? initials(data.player.name) : "YO"}</span>
              <div className="details">
                <strong>{data.player?.name ?? "You"}</strong>
                <small>{run ? `${run.asset === "devnet" ? "Devnet" : "Demo"} match` : started ? "Practice run" : "Ready when you are"}</small>
              </div>
              <span className="score lime">{game.score}</span>
            </div>
            <p className="live-note">
              {run
                ? `Match ${shortId(run.match_id)} · Your opponent receives the same brick sequence.`
                : "No waiting room. Finish your run and we’ll keep your score until your opponent finishes theirs."}
            </p>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h3>Your recent matches</h3>
              <History />
            </div>
            {data.matches.length === 0 ? (
              <div className="mini-empty">
                Your first rivalry starts here.
                <br />
                Enter a match to get going.
              </div>
            ) : (
              data.matches.slice(0, 3).map((m) => (
                <Link href="/matches" key={m.id} className="math-line" style={{ padding: "10px 0", borderBottom: "1px solid #2a3548" }}>
                  <span>{sol(m.stake)} SOL</span>
                  <strong style={{ fontSize: 12 }}>{outcome(m)}</strong>
                </Link>
              ))
            )}
            <Link href="/matches" className="btn full" style={{ marginTop: 10 }}>
              All matches <ArrowUpRight />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
