import Link from "next/link";
import { LEGAL, operatorName } from "@/lib/legal";
import { FactTable, LegalPage, type LegalSection } from "./legal-page";

/** How to reach the operator about personal data. */
function Contact() {
  return LEGAL.email ? (
    <>
      by email at <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
    </>
  ) : (
    <>through the Report a bug form at the bottom of every page, starting the title with “Privacy request”</>
  );
}

const SECTIONS: LegalSection[] = [
  {
    id: "controller",
    title: "Who is responsible",
    body: (
      <>
        <p>
          Bounce is run by <strong>{operatorName()}</strong>
          {LEGAL.address ? `, ${LEGAL.address}` : ""}, the controller of the personal data described here under the EU and UK General Data Protection
          Regulation (GDPR). You can reach us about anything in this policy <Contact />.
        </p>
        <p>This policy covers the website, the game and everything attached to your Bounce account. It does not cover the sites of the sign-in providers or wallets you use with it, which have their own.</p>
      </>
    ),
  },
  {
    id: "what",
    title: "What we collect",
    body: (
      <>
        <p>We collect as little as running a competitive game needs. We never receive your password, and we do not ask for your email address, your real name, your date of birth or your phone number.</p>
        <FactTable
          head={["Category", "What it is"]}
          rows={[
            ["Account", "A stable account ID from your sign-in method: github:12345, google:…, discord:…, or solana:<your wallet address>. The display name your provider sends is kept in your session cookie only."],
            ["Profile", "The player name and picture you choose, your theme, your rank, your referral code and who referred you."],
            ["Games", "Every board you play: its seed, each shot's angle and timing, how you aimed before each shot (replayed to spectators), scores, results, tournaments entered and quests and rewards claimed."],
            ["Money", "Your gem and SOL ledgers, entries, payouts, tips, your Bounce deposit address, the wallet addresses you deposit from or withdraw to, and the blockchain signatures of those transfers."],
            ["Security", "Your encrypted authenticator secret and hashed recovery codes if you turn on two-factor authentication, failed code attempts, sign-out-everywhere events, security holds, and alerts sent to you."],
            ["Fair play", "Signals from the anti-cheat: aim timing and movement, whether input came from a real device, whether the browser reports being automated, and how each real-money shot compares with every other possible angle."],
            ["Social", "Friends, friend requests, messages between friends, blocks and reports you make or that concern you."],
            ["Support", "Bug reports you send: title, description, the page you were on, links, and any screenshot or video you attach."],
            ["Notifications", "Notices about your matches and account and, if you allow them, a push subscription for this browser (an address at your browser's push service)."],
            ["Technical", "Your IP address, used only for a few minutes to limit abuse (requests per minute), and the days you were active, used for aggregate retention figures. Our host also keeps short-lived server logs."],
          ]}
        />
      </>
    ),
  },
  {
    id: "why",
    title: "Why we use it, and on what legal basis",
    body: (
      <FactTable
        head={["Purpose", "Legal basis (GDPR art. 6)"]}
        rows={[
          ["Running your account, matches, tournaments, rewards and leaderboards", "Performance of our contract with you (the Terms of Use)"],
          ["Holding, moving and accounting for gems and SOL, deposits and withdrawals", "Performance of the contract; legal obligations on accounting and, where they apply, on anti-money-laundering checks"],
          ["Keeping accounts and money safe: two-factor codes, rate limits, security alerts, holds", "Our legitimate interest, and yours, in preventing fraud and account theft"],
          ["Detecting cheating, bots, collusion and multiple accounts", "Our legitimate interest, and other players', in fair games for money"],
          ["Friends, messages, reports and blocks", "Performance of the contract"],
          ["Answering bug reports", "Our legitimate interest in fixing the service"],
          ["Push notifications", "Your consent, given in your browser, which you can withdraw at any time"],
          ["Aggregate statistics (active players, retention)", "Our legitimate interest in understanding how the service is used; no individual profile is built for marketing"],
        ]}
      />
    ),
  },
  {
    id: "automated",
    title: "Automated decisions",
    body: (
      <>
        <p>
          To keep games for money fair, the anti-cheat can <strong>suspend an account automatically</strong> when there is technical proof of automated play (for
          example a browser driven by a script, or shots arriving faster than a person can aim), and can open a review when a player’s shots are statistically far
          beyond anyone else’s. A suspension holds the account’s money; it does not take it.
        </p>
        <p>
          You have the right to a human review: a suspended player can appeal once from the notice they see, and an administrator decides. Only an administrator,
          after review, can close an account for cheating. You can also contest a decision <Contact />.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "What other people can see",
    body: (
      <>
        <p>
          Your player name, picture, rank, public statistics, finished results and the boards you play (shot by shot, once others may watch them) are public. Your
          balances, wallet addresses, transfers, tips, messages, notifications and security settings are only ever sent to your own session. Account IDs never leave
          our servers, except that a wallet account’s ID is its public address.
        </p>
        <p>
          <strong>Blockchain transfers are public by nature.</strong> A deposit or withdrawal is recorded on the Solana network, where anyone can see the addresses and
          amounts involved, permanently. Neither we nor anyone else can erase it.
        </p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "Who we share it with",
    body: (
      <>
        <p>We do not sell personal data, and we do not share it with advertisers. It is handled for us by these providers, under contracts that bind them to our instructions:</p>
        <FactTable
          head={["Provider", "Role"]}
          rows={[
            ["Vercel Inc. (USA)", "Hosting, server logs and storage of bug report attachments"],
            ["Turso (ChiselStrike Inc., USA)", "Database"],
            ["GitHub, Google, Discord", "Sign-in, only if you choose that method; they learn that you signed in to Bounce"],
            ["Your browser's push service (Google, Mozilla, Apple, Microsoft)", "Delivering push notifications, encrypted end to end, only if you turn them on"],
            ["Solana network", "Recording deposits and withdrawals, publicly"],
          ]}
        />
        <p>We may also disclose data when the law requires it, or to establish or defend legal claims.</p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "Transfers outside Europe",
    body: (
      <p>
        Some providers above are based in the United States. Transfers rely on the EU-US Data Privacy Framework where the provider is certified under it, and
        otherwise on the European Commission’s Standard Contractual Clauses, with the additional safeguards they require. You can ask us for a copy of the safeguards
        that apply <Contact />.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <FactTable
        head={["Data", "Kept for"]}
        rows={[
          ["Profile, friends, messages, notifications, push subscriptions, authenticator", "Until you close your account, then deleted"],
          ["Finished games, ledgers and transfers", "As long as accounting and anti-fraud obligations require (up to 10 years); after you close your account they are kept without your name or picture, because removing one side of a settled match would falsify the other player's records"],
          ["Anti-cheat signals and sanctions", "While the account exists, so a decision can be reviewed; afterwards only as part of the records above"],
          ["Bug reports and attachments", "Until the report is dealt with and no longer useful, and in any case removed when you close your account; unsent uploads are removed within 24 hours"],
          ["IP addresses for rate limiting", "A few minutes"],
          ["Sign-in challenges for wallets", "Five minutes, or until used"],
          ["Hosting logs", "As set by our host, typically a few days"],
        ]}
      />
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the GDPR you have the right to:</p>
        <ul>
          <li>
            <strong>access</strong> your data and <strong>take it with you</strong>: the <Link href="/profile">Download my data</Link> button on your profile gives you
            every row we hold about your account, as a file;
          </li>
          <li>
            <strong>correct</strong> it: your name and picture can be changed on your profile at any time;
          </li>
          <li>
            <strong>erase</strong> it: your profile can delete your account, with the limits explained under “How long we keep it”;
          </li>
          <li>
            <strong>object</strong> to processing based on our legitimate interest, and <strong>restrict</strong> processing while a request is examined;
          </li>
          <li>
            <strong>withdraw consent</strong> to push notifications from the notification menu or your browser settings;
          </li>
          <li>
            not be subject to a decision based solely on automated processing without a human review (see “Automated decisions”).
          </li>
        </ul>
        <p>
          For anything the profile cannot do, write to us <Contact />. We answer within one month. You can also complain to the data protection authority of the
          country where you live or work, or where you think the problem occurred.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    body: (
      <>
        <p>
          Bounce uses <strong>no analytics, advertising or third-party cookies</strong>. What it stores in your browser is what it needs to work, or what you asked it
          to remember, so it does not require consent; the banner you see on your first visit says so once.
        </p>
        <FactTable
          head={["Name", "Purpose", "Lifetime"]}
          rows={[
            [<code key="s">authjs.session-token</code>, "Keeps you signed in (HttpOnly, Secure, SameSite=Lax)", "7 days, renewed while you play"],
            [<code key="c">authjs.csrf-token</code>, "Protects sign-in forms against forgery", "Session"],
            [<code key="u">authjs.callback-url</code>, "Where to return after signing in", "Session"],
            [<code key="ck">bounce.cookies</code>, "Remembers that you have seen the cookie notice", "Until you clear it"],
            [<code key="m">bounce.money</code>, "The currency you chose to read amounts in", "Until you clear it"],
            [<code key="snd">bounce.sound</code>, "Whether sound is muted", "Until you clear it"],
            [<code key="co">bounce.coached</code>, "That you have seen the first-run guide", "Until you clear it"],
            [<code key="r">ricochet:ref</code>, "The referral code of the link you followed, applied if you sign up", "Until you sign up"],
            [<code key="n">bounce.next</code>, "The page to return to after signing up, such as a challenge", "Until you sign up"],
            [<code key="ss">Session storage</code>, "Notices you dismissed and unsent bug report drafts in this tab", "Until the tab closes"],
          ]}
        />
        <p>Cookie names may carry a <code>__Secure-</code> prefix over HTTPS. You can delete all of them from your browser settings; you will be signed out.</p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <p>
        Data travels over HTTPS only. Wallet keys and authenticator secrets are encrypted at rest; recovery codes are stored as keyed hashes. Withdrawals, larger tips
        and administrator changes require a code from an authenticator app, and sensitive changes require you to sign in again. Every request is rate limited, and
        any sign of a breach that puts your rights at risk will be reported to the supervisory authority within 72 hours and, where required, to you.
      </p>
    ),
  },
  {
    id: "age",
    title: "Age",
    body: <p>Bounce is for adults only. You must be at least {LEGAL.minimumAge} years old to create an account. If we learn that an account belongs to someone younger, we close it.</p>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: <p>When this policy changes, the date at the top changes with it. If the change is significant, we will tell signed-in players with a notice on the site before it takes effect.</p>,
  },
];

export function PrivacyView() {
  return (
    <LegalPage
      eyebrow="PRIVACY POLICY · GDPR"
      title="Your data, and what we do with it."
      intro={
        <>
          <p>No trackers, no ad networks, no data sales. This policy explains what Bounce collects, why, who handles it, how long it is kept and how to use your rights.</p>
          <p>
            Your account’s data can be downloaded or deleted at any time from <Link href="/profile">your profile</Link>.
          </p>
        </>
      }
      sections={SECTIONS}
    />
  );
}
