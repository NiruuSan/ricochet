"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Zap } from "lucide-react";
import { signInWithGitHub } from "../../auth-actions";
import { gameAction } from "../api";
import type { PlayerState } from "../arena";

export function AuthView({ player, signup }: { player: PlayerState; signup: boolean }) {
  const { data, loaded, setError } = player;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const createProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await gameAction({ action: "signup", name });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel auth-card">
      <span className="brand-icon" style={{ marginBottom: 25 }}>
        <Zap />
      </span>
      <h1>{data.player ? "You’re in." : signup ? "Find your player name." : "Welcome back."}</h1>
      <p className="muted" style={{ marginTop: 15 }}>
        {data.player ? `Ready for another run, ${data.player.name}?` : "One account. Your matches, your scores, your next great bounce."}
      </p>
      {!loaded ? (
        <p className="muted" style={{ marginTop: 25 }}>
          Checking your account…
        </p>
      ) : data.player ? (
        <Link href="/" className="btn btn-primary full">
          Back to the arena <ArrowRight />
        </Link>
      ) : !data.authenticated ? (
        <>
          <form action={signInWithGitHub.bind(null, "/signup")}>
            <button className="btn btn-primary full">
              Continue with GitHub <ArrowUpRight />
            </button>
          </form>
          <p className="fine center" style={{ marginTop: 20 }}>
            Sign in with your GitHub account. Only your account ID and display name are used.
          </p>
        </>
      ) : (
        <form onSubmit={createProfile}>
          <label className="field">
            Player name
            <input
              autoComplete="nickname"
              className="input"
              placeholder="Your next alias"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]{3,20}"
              required
            />
          </label>
          <p className="fine">3–20 letters, numbers or underscores. Visible to other players.</p>
          <button className="btn btn-primary full" disabled={saving}>
            {saving ? "Creating profile…" : "Create profile + 20 demo SOL"}
            <ArrowRight />
          </button>
        </form>
      )}
      <p className="fine center" style={{ marginTop: 25 }}>
        Want to give it a spin first?{" "}
        <Link className="lime" href="/">
          Play free practice.
        </Link>
      </p>
    </section>
  );
}
