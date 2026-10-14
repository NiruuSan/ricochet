"use client";
import { Form } from "@/components/ui/form";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { STARTING_GEMS } from "@/lib/api-types";
import { LEGAL } from "@/lib/legal";
import { signInWith, type SignInProvider } from "../../auth-actions";
import { gameAction } from "../api";
import type { PlayerState } from "../arena";
import { InAppNotice, useInApp } from "../in-app-notice";
import { forgetNext, forgetReferral, rememberedNext, rememberedReferral, rememberReferral, safeNext } from "../referral-link";
import { signInWithWallet, useSolanaWallets, walletAppLinks, type SolanaWallet } from "../solana-wallet";
import styles from "./auth.module.css";

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

/**
 * A referral code from an invite link. It is kept in the browser so it survives
 * the trip to the sign-in provider and back, and it only counts when the
 * profile is created (lib/referrals.ts).
 */
function useReferralCode() {
  // The link's code is what the sign-in buttons carry back; the stored one is
  // what survives a trip that dropped the query string.
  const code = useSearchParams().get("ref") ?? "";
  useEffect(() => rememberReferral(code), [code]);
  return {
    code,
    /** The code to sign up with: the one in hand, or the one from the link that started this. */
    take: () => code || rememberedReferral() || "",
    clear: forgetReferral,
  };
}

/**
 * Where to go once signed in: a challenge seat or another page the visitor was
 * on when they were asked to sign in. It rides along in the address, and in
 * the browser for trips that drop it.
 */
const noSubscription = () => () => {};
function useNext() {
  const fromLink = safeNext(useSearchParams().get("next"));
  const stored = useSyncExternalStore(noSubscription, rememberedNext, () => null);
  return fromLink ?? stored;
}

/** The address the sign-in comes back to: profile creation, carrying the referral code and the destination. */
function signupPath(ref: string, next: string | null) {
  const query = new URLSearchParams();
  if (ref) query.set("ref", ref);
  if (next) query.set("next", next);
  const text = query.toString();
  return text ? `/signup?${text}` : "/signup";
}

/** Signing in with a Solana wallet: the extension here, or the wallet app's own browser on a phone. */
function WalletSignIn({ returnTo }: { returnTo: string }) {
  const wallets = useSolanaWallets();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const href = useSyncExternalStore(noSubscription, () => window.location.href, () => "");
  const phone = useSyncExternalStore(noSubscription, () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent), () => false);

  const go = async (wallet: SolanaWallet) => {
    setBusy(wallet.name);
    setError("");
    const failed = await signInWithWallet(wallet, returnTo);
    // A good sign-in navigates away; anything that comes back is a reason.
    if (failed) setError(failed);
    setBusy(null);
  };

  return (
    <div className={styles.wallets}>
      {wallets.length ? (
        wallets.map((wallet) => (
          <button key={wallet.name} type="button" className={`btn full provider-button ${styles.walletButton}`} disabled={!!busy} onClick={() => void go(wallet)}>
            <img src={wallet.icon} alt="" width={20} height={20} />
            {busy === wallet.name ? "Check your wallet…" : `Continue with ${wallet.name}`}
          </button>
        ))
      ) : phone && href ? (
        <>
          <p className={styles.walletHint}>Your wallet lives in its app. Open Bounce there to sign in with it:</p>
          <div className={styles.walletApps}>
            {walletAppLinks(href).map((app) => (
              <a key={app.name} className="btn provider-button" href={app.href}>
                <Wallet size={18} /> Open in {app.name}
              </a>
            ))}
          </div>
        </>
      ) : (
        <a className="btn full provider-button" href="https://phantom.app/download" target="_blank" rel="noreferrer">
          <Wallet size={18} /> Get a Solana wallet
        </a>
      )}
      {error && (
        <p className="error" role="alert" style={{ marginTop: 4 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthView({ player, signup }: { player: PlayerState; signup: boolean }) {
  const { data, loaded, setError } = player;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const providers = useSignInProviders();
  const referral = useReferralCode();
  const next = useNext();
  const inApp = useInApp();
  // Google turns embedded browsers away outright, so its button is not offered there.
  const shown = inApp ? providers.filter((p) => p !== "google") : providers;
  const returnTo = signupPath(referral.code, next);

  // Already in, with somewhere to be: go straight there.
  const hasProfile = !!data.player;
  useEffect(() => {
    if (!hasProfile || !next) return;
    forgetNext();
    window.location.replace(next);
  }, [hasProfile, next]);

  const createProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await gameAction({ action: "signup", name, ref: referral.take() || undefined });
      referral.clear();
      forgetNext();
      window.location.href = next ?? "/";
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
        <Link href={next ?? "/"} className="btn btn-primary full" style={{ marginTop: 25 }}>
          {next ? "Carry on" : "Back to the arena"} <ArrowRight />
        </Link>
      ) : !data.authenticated ? (
        <>
          <InAppNotice firm />
          <div className="provider-buttons">
            <WalletSignIn returnTo={returnTo} />
            <div className={styles.or}>
              <span>or</span>
            </div>
            {shown.map((provider) => (
              <Form key={provider} action={signInWith.bind(null, provider, returnTo)}>
                <button className="btn full provider-button">
                  {LOGOS[provider]}
                  Continue with {LABELS[provider]}
                </button>
              </Form>
            ))}
          </div>
          <p className="fine center" style={{ marginTop: 20 }}>
            Only your account ID and display name are used. A wallet only signs a message: it costs nothing and moves no funds. Each sign-in method is a
            separate player account. By continuing you accept the{" "}
            <Link className="lime" href="/terms">
              Terms
            </Link>{" "}
            and the{" "}
            <Link className="lime" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </>
      ) : (
        <Form onSubmit={createProfile}>
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
          <p className="fine">
            By creating a profile you confirm you are {LEGAL.minimumAge} or older, not in a country where Bounce is unavailable, and accept the{" "}
            <Link className="lime" href="/terms">
              Terms
            </Link>
            .
          </p>
          <button className="btn btn-primary full" disabled={saving}>
            {saving ? "Creating profile…" : `Create profile + ${STARTING_GEMS.toLocaleString("en")} gems`}
            <ArrowRight />
          </button>
        </Form>
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
