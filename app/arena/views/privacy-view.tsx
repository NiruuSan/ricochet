import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** What the site keeps, why, and what a player can do about it. */
const SECTIONS: [string, string][] = [
  [
    "What Bounce knows about you",
    "Your sign-in provider (GitHub, Google or Discord) tells us one thing: a stable account ID such as github:12345. That ID is your account. We never receive your password, and we do not store your email address. Everything else is what you made here: the name and picture you chose, the boards you played and their scores, your gem and devnet SOL ledgers, your transfers and tips, your notifications, and — if you turned it on — an encrypted authenticator secret.",
  ],
  [
    "Why each part is kept",
    "Your name and picture appear to other players on the leaderboard, in matches and on your public profile. Your games and ledger lines are what a match settles from, and each one balances against another account, so they are also the house's accounting record. Anti-cheat observations are kept so a decision about an account can be reviewed later. Nothing here is used for advertising, and nothing is sold.",
  ],
  [
    "What other people can see",
    "Your player name, picture, level, public match statistics and the boards you play are public. Your balances, your wallet address, your transfers, your tips, your notifications and your security settings are not: they are only ever sent to your own session. Player IDs never leave the server.",
  ],
  [
    "Cookies",
    "One cookie: your sign-in session. It is HttpOnly, SameSite=Lax and Secure over HTTPS, it lasts a week, and it carries nothing but your account ID and when you last signed in. There are no analytics, advertising or third-party cookies on this site.",
  ],
  [
    "Where it lives",
    "The site runs on Vercel and the database is Turso. Devnet SOL balances are held in wallets whose keys are encrypted at rest; the amounts themselves are test funds with no monetary value. Push notifications, when you turn them on, go through your browser's own push service (Google, Mozilla, Apple or Microsoft), which receives only an encrypted message.",
  ],
  [
    "Taking your data with you",
    "Your profile page has a Download my data button: it hands you a JSON file with every row the site holds about your account, exactly as it is stored — minus the keys that are not yours to have, such as the key your wallet is encrypted with and the secret behind your authenticator.",
  ],
  [
    "Closing your account",
    "The same page deletes your account. Your name, picture, notifications, notification devices and authenticator are deleted. Your finished games and the ledger lines that balance against other players keep their rows with nobody behind them, because removing one side of a settled match would falsify the other player's history and the house accounts. Your deposit address stays on file for the same reason. Signing in again starts a fresh profile, with a new name, on the same account.",
  ],
  [
    "Security",
    "Withdrawals and larger tips need a code from your authenticator app. Changing two-factor authentication or deleting your account needs a fresh sign-in with your provider. Any of those events, and any money leaving your balance, raises a notice you will see the next time you open Bounce. If something looks wrong, Sign out everywhere in your wallet's security panel ends every session, on every device, at once.",
  ],
  [
    "Test funds only",
    "Bounce runs on Solana devnet. Devnet SOL is issued freely for testing and has no monetary value, cannot be exchanged for money, and is not a payment service. Gems are an in-game currency with no value outside the game.",
  ],
];

export function PrivacyView() {
  return (
    <section className="subpage" style={{ maxWidth: 850 }}>
      <div className="tag lime" style={{ marginBottom: 12 }}>
        PLAIN ANSWERS, NO SMALL PRINT
      </div>
      <h1>Your data, and what we do with it.</h1>
      <p className="muted">No trackers, no ad networks, no data sales. Here is everything, in order.</p>
      <div className="faq">
        {SECTIONS.map(([title, body], i) => (
          <details key={title} open={i === 0}>
            <summary>{title}</summary>
            <p>{body}</p>
          </details>
        ))}
      </div>
      <Link href="/profile" className="btn btn-primary">
        Your data is on your profile <ArrowRight />
      </Link>
    </section>
  );
}
