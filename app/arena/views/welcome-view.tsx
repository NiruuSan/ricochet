"use client";
import Link from "next/link";
import { ArrowRight, Layers, Target, Zap } from "lucide-react";
import { Board } from "../board";
import type { GameSession } from "../use-game-session";

const FEATURES = [
  { Icon: Target, title: "Same board. Your strategy.", description: "Both players get identical seeded brick spawns. Pick the angles that keep your run alive." },
  { Icon: Zap, title: "Play on your own time.", description: "Start now. Your opponent can join before or after you finish. No waiting for a live lobby." },
  { Icon: Layers, title: "One more ball. One more chance.", description: "Build your volley every round. Clear the board and earn four extra balls." },
];

export function WelcomeView({ session }: { session: GameSession }) {
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow tag lime">A FRESH ANGLE ON 1V1</div>
          <h1>
            Small ball.
            <br />
            Big <span className="lime">energy.</span>
          </h1>
          <p>A brick-breaker with a competitive streak. Challenge another player on the exact same board. Your angle makes the difference.</p>
          <div className="row-actions">
            <Link href="/" className="btn btn-primary">
              Jump into the arena <ArrowRight />
            </Link>
            <Link href="/rules" className="btn">
              Learn the game
            </Link>
          </div>
          <p className="fine" style={{ fontSize: 13 }}>
            Free practice & gem matches. No real money.
          </p>
        </div>
        <div className="hero-game">
          <Board session={session} mini />
        </div>
      </section>
      <section className="feature-grid">
        {FEATURES.map(({ Icon, title, description }) => (
          <div className="panel" key={title}>
            <Icon />
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        ))}
      </section>
    </>
  );
}
