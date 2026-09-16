"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { STARTING_GEMS } from "@/lib/api-types";
import { signInWith, type SignInProvider } from "../../auth-actions";
import { gameAction } from "../api";
import type { PlayerState } from "../arena";

const LOGOS: Record<SignInProvider, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#5865F2"
        d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9 0 13.6.3 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.8-3.8-13.7zM8.5 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"
      />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"
      />
    </svg>
  ),
};

const LABELS: Record<SignInProvider, string> = { google: "Google", discord: "Discord", github: "GitHub" };
const ORDER: SignInProvider[] = ["google", "discord", "github"];

/** Providers the server has credentials for, from Auth.js's own provider list. GitHub is always available. */
function useSignInProviders() {
  const [providers, setProviders] = useState<SignInProvider[]>(["github"]);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((list: Record<string, unknown>) => active && setProviders(ORDER.filter((id) => id in list)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return providers;
}

export function AuthView({ player, signup }: { player: PlayerState; signup: boolean }) {
  const { data, loaded, setError } = player;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const providers = useSignInProviders();

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
      <img src="/brand/bounce-icon-rotated.svg" alt="Bounce" width={52} height={52} style={{ display: "block", marginBottom: 22 }} />
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
          <div className="provider-buttons">
            {providers.map((provider) => (
              <form key={provider} action={signInWith.bind(null, provider, "/signup")}>
                <button className="btn full provider-button">
                  {LOGOS[provider]}
                  Continue with {LABELS[provider]}
                </button>
              </form>
            ))}
          </div>
          <p className="fine center" style={{ marginTop: 20 }}>
            Only your account ID and display name are used. Each sign-in method is a separate player account.
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
            {saving ? "Creating profile…" : `Create profile + ${STARTING_GEMS.toLocaleString("en")} gems`}
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
