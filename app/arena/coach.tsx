"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Gem, MousePointerClick, Sparkles, Target, X } from "lucide-react";
import Link from "next/link";
import type { GameSession } from "./use-game-session";

// The first run, explained by playing it.
//
// A promo video sends strangers to a board they have never seen. Rather than a
// page of rules nobody reads, the game teaches itself: four short cards, each
// waiting for the thing it just asked for. Aiming clears the first, the shot
// clears the second, and so on — so a player who already knows what they are
// doing never reads a word, and a player who does not is never stuck.
//
// It runs once, in practice only, and never over a match: the first thing
// somebody does here should not be to lose an entry to a tutorial.

const KEY = "bounce.coached";

/** Whether this browser has already been walked through a board. */
function seen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Storage refused: better to show it than to hide it from a new player.
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // The guide simply comes back next time.
  }
}

/** Lets the player ask for it again (the rules page). */
export function replayCoach() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

type Step = {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  /** The word on the button while this card waits for the player to act. */
  hint: string;
};

const STEPS: Step[] = [
  {
    icon: <MousePointerClick size={16} />,
    title: "Aim anywhere above the line",
    body: (
      <>
        Move across the board and the dotted line follows you. The arrow keys work too, a couple of degrees at a time.
      </>
    ),
    hint: "Move your aim",
  },
  {
    icon: <Target size={16} />,
    title: "Let it bounce",
    body: <>Release — or press Enter. Every ball you have follows that same line and takes whatever it meets on the way.</>,
    hint: "Take your shot",
  },
  {
    icon: <Sparkles size={16} />,
    title: "The numbers are hit points",
    body: <>Each touch takes one off a brick. Every shot you take, the whole wall drops a row: let it reach the line and the run is over.</>,
    hint: "Keep going",
  },
  {
    icon: <Gem size={16} />,
    title: "Clear the board for five balls",
    body: (
      <>
        Leave nothing standing and you take five bonus balls at once — that is how a run turns into a score. Then bring it to a rival: matches, quests and the
        daily gems all pay in the same currency.
      </>
    ),
    hint: "Got it",
  },
];

/**
 * The guide itself. It reads the session the same way a person watching over
 * the player's shoulder would: the aim moved, the shot went, the balls landed.
 * Those are props changing, not events, so each one is answered while
 * rendering rather than in an effect — the card is a function of the board.
 */
export function Coach({ session }: { session: GameSession }) {
  const { started, run, angle, flying, game } = session;
  const practice = started && !run && !game.over;
  // Storage is a browser thing: the server renders no guide, and the first
  // client render decides.
  const already = useSyncExternalStore(
    () => () => {},
    seen,
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(0);
  const [shots, setShots] = useState(0);
  const [wasFlying, setWasFlying] = useState(flying);
  /** The aim as the board opened: anything else means the player has aimed. */
  const [openedAngle] = useState(angle);

  // The aim moving answers the first card.
  if (step === 0 && Math.abs(angle - openedAngle) >= 2) setStep(1);
  // A shot answers the second, and the landing of the second shot the third.
  if (flying !== wasFlying) {
    setWasFlying(flying);
    if (flying) {
      setShots(shots + 1);
      if (step < 2) setStep(2);
    } else if (shots >= 2 && step < 3) {
      setStep(3);
    }
  }

  const card = STEPS[step];
  const showing = !already && !dismissed && practice;
  const close = () => {
    remember();
    setDismissed(true);
  };

  // On a phone the board is drawn at whatever height is left over, so the guide
  // has to be counted as part of the frame around it — otherwise the board
  // grows past the bottom of the screen and takes the sound and speed buttons
  // with it. The card reports its own height, wrapping included.
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const report = () => document.body.style.setProperty("--coach-height", `${Math.ceil(node.getBoundingClientRect().height) + 12}px`);
    report();
    const watch = new ResizeObserver(report);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("coaching", showing);
    return () => {
      document.body.classList.remove("coaching");
      document.body.style.removeProperty("--coach-height");
    };
  }, [showing]);

  return !showing ? null : (
    <div className="coach" role="status" aria-live="polite">
      <div className="coach-card" ref={measure}>
        <span className="coach-icon" aria-hidden>
          {card.icon}
        </span>
        <div className="coach-copy">
          <b>{card.title}</b>
          <p>{card.body}</p>
          {step === STEPS.length - 1 && (
            <Link className="coach-link" href="/quests" onClick={close}>
              See the quests <ChevronRight size={13} />
            </Link>
          )}
        </div>
        <div className="coach-side">
          <span className="coach-count">
            {step + 1}/{STEPS.length}
          </span>
          {step === STEPS.length - 1 ? (
            <button className="btn btn-primary coach-done" onClick={close}>
              {card.hint}
            </button>
          ) : (
            <>
              <span className="coach-hint">{card.hint}</span>
              <button className="coach-skip" onClick={close}>
                <X size={13} /> Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
