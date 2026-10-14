import Link from "next/link";
import { LEGAL, operatorName } from "@/lib/legal";
import { MIN_DEPOSIT } from "@/lib/api-types";
import { LegalPage, type LegalSection } from "./legal-page";

const countries = new Intl.ListFormat("en", { type: "conjunction" }).format(LEGAL.restricted);

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "The agreement",
    body: (
      <>
        <p>
          These Terms of Use are a contract between you and <strong>{operatorName()}</strong>
          {LEGAL.address ? `, ${LEGAL.address}` : ""} (“Bounce”, “we”). By creating an account or playing a match you accept them, together with the{" "}
          <Link href="/rules">game rules</Link> and the <Link href="/privacy">Privacy Policy</Link>. If you do not accept them, do not use Bounce.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who may play",
    body: (
      <>
        <p>To use Bounce you must:</p>
        <ul>
          <li>be at least {LEGAL.minimumAge} years old, and of legal age to play games for money where you are;</li>
          <li>
            not be located in, or a resident of, <strong>{countries}</strong>, or any country where taking part in online games of skill for money is prohibited or
            requires a licence Bounce does not hold — checking that is your responsibility;
          </li>
          <li>not hide or disguise where you are, for example with a VPN or proxy, to get around these restrictions;</li>
          <li>not have had an account closed by us for breaking these Terms.</li>
        </ul>
        <p>We may ask you to confirm any of this and refuse, suspend or close an account that does not meet it. Entries and winnings obtained in breach of this section may be void.</p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <>
        <p>
          You sign in with GitHub, Google, Discord or a Solana wallet. Each sign-in method is a separate account. One person may play with one account; running several
          accounts to play against yourself, claim rewards more than once or move money between them is forbidden.
        </p>
        <p>
          Keep your sign-in method, your wallet and your authenticator app secure: anyone with them can act as you. Turn on two-factor authentication before
          withdrawing. If you think your account has been used by someone else, use Sign out everywhere in your wallet and tell us at once.
        </p>
      </>
    ),
  },
  {
    id: "game",
    title: "The game",
    body: (
      <>
        <p>
          Bounce is a game of skill. In a 1v1 match both players get the same board, generated from the same seed, and play one run each, in their own time; the
          higher final score wins. Tournaments rank everyone who plays the same board. The full rules, including how forfeits, ties and abandoned runs are settled,
          are on the <Link href="/rules">rules page</Link> and form part of these Terms.
        </p>
        <p>
          A run left without a shot for 24 hours ends at its current score, as a forfeit would. A seat nobody takes within 48 hours closes and the entry is returned in
          full. The server’s record of a game is final.
        </p>
      </>
    ),
  },
  {
    id: "gems",
    title: "Gems",
    body: (
      <p>
        Gems are an in-game currency. They are free, have no monetary value, cannot be bought, sold, withdrawn or exchanged for money, and are not your property: they
        are a licence to use features of the game. We may change how gems are earned or spent, and gems lapse when an account is closed.
      </p>
    ),
  },
  {
    id: "sol",
    title: "SOL matches, entries and fees",
    body: (
      <>
        <p>
          Matches and tournaments may be played for SOL, the currency of the Solana network. Your entry is taken from your Bounce balance when you take a seat and
          held until the match settles. When a match has a winner, the house keeps <strong>12% of the pot</strong> and the winner receives the rest; a tie returns
          both entries. Tournament prize pools are the entries less the house share, paid out by final rank as shown on each tournament before you enter.
        </p>
        <p>
          <strong>Test network.</strong> While the site shows “Test mode”, Bounce runs on Solana devnet: devnet SOL is test currency with no monetary value and cannot
          be exchanged for money. These Terms apply to it all the same.
        </p>
      </>
    ),
  },
  {
    id: "money",
    title: "Deposits and withdrawals",
    body: (
      <>
        <ul>
          <li>Deposits are credited once the network has finalised them. The minimum is {MIN_DEPOSIT / 1e9} SOL; smaller amounts wait until the total reaches it.</li>
          <li>
            Withdrawals need a code from your authenticator app and go only to the address you enter. Blockchain transfers cannot be reversed: an address you got
            wrong cannot be corrected by us.
          </li>
          <li>Network fees are added to each withdrawal. Withdrawals are limited to 50 SOL per 24 hours unless we announce otherwise.</li>
          <li>
            We may delay or hold a withdrawal while we check for fraud, cheating, a security incident or a legal requirement, and we may ask for information before
            releasing it.
          </li>
          <li>Your balance is not a bank deposit, earns no interest and is not protected by any deposit guarantee scheme.</li>
        </ul>
      </>
    ),
  },
  {
    id: "fair-play",
    title: "Fair play",
    body: (
      <>
        <p>You must play every shot yourself. In particular, you must not:</p>
        <ul>
          <li>use bots, scripts, solvers, macros, modified clients or any tool that aims, plays or calculates shots for you;</li>
          <li>agree results with another player, lose on purpose or pass money between accounts through matches or tips;</li>
          <li>exploit a bug instead of reporting it, or interfere with the service, other players or our systems.</li>
        </ul>
        <p>
          The anti-cheat checks every game for money. When it finds proof of automated play, the account is suspended at once and its money is held; statistical
          findings are reviewed by a person. A suspended player may appeal once. If cheating is confirmed we may forfeit the matches concerned to the opponents,
          exclude the player from rankings and prizes, close the account and keep its balance. See the <Link href="/privacy#automated">Privacy Policy</Link> for how
          these decisions are made.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Names, pictures and messages",
    body: (
      <p>
        What you put on Bounce must not be unlawful, hateful, harassing, sexual, impersonating someone or advertising. You keep the rights to your picture and
        messages and give us the licence needed to show them on the service. We may remove content and rename or suspend accounts that break this rule. You can block
        and report any player.
      </p>
    ),
  },
  {
    id: "rewards",
    title: "Rewards, referrals and promotions",
    body: (
      <p>
        Daily gems, quests, cashback, the weekly race, referral discounts and any other promotion follow the conditions shown in the game when you take part. We may
        change, suspend or end them going forward, and cancel rewards obtained by abuse, including through multiple accounts or referring yourself.
      </p>
    ),
  },
  {
    id: "responsible",
    title: "Play responsibly",
    body: (
      <p>
        Only play with money you can afford to lose, and never chase losses. If playing stops being fun, take a break: you can close your account at any time from
        your profile. If gambling is causing you harm, contact a support service in your country.
      </p>
    ),
  },
  {
    id: "service",
    title: "Availability and changes",
    body: (
      <p>
        We work to keep Bounce available but cannot promise it will be uninterrupted or error-free. We may change, suspend or retire features, and we may change these
        Terms; the date at the top shows the latest version, and significant changes will be announced on the site before they apply. Matches in progress are settled
        under the rules they started with.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <>
        <p>
          Bounce is provided as it is. To the extent the law allows, we are not liable for indirect losses, lost profits, or losses caused by the blockchain, your
          wallet, your devices, your connection or third parties, and our total liability to you is limited to the balance of your account at the time the claim
          arises.
        </p>
        <p>Nothing in these Terms limits liability that cannot be limited by law, or your rights as a consumer under the law that applies to you.</p>
      </>
    ),
  },
  {
    id: "closing",
    title: "Closing an account",
    body: (
      <p>
        You can close your account from your profile once no game is in play and your balance has been withdrawn. We may suspend or close an account that breaks
        these Terms, or when the law requires it. If we close an account for any reason other than cheating or fraud, we return its SOL balance to an address you give
        us.
      </p>
    ),
  },
  {
    id: "law",
    title: "Applicable law and disputes",
    body: (
      <p>
        These Terms are governed by the law of the country where {operatorName()} is established, without depriving you of the protection of mandatory rules of the
        country where you live. Before going to court, contact us so we can try to settle the matter; if that fails, the courts with jurisdiction under that law
        decide.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.email ? (
          <>
            Write to <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
          </>
        ) : (
          <>Use the Report a bug form at the bottom of every page</>
        )}
        {LEGAL.address ? ` or to ${LEGAL.address}` : ""}.
      </p>
    ),
  },
];

export function TermsView() {
  return (
    <LegalPage
      eyebrow="TERMS OF USE"
      title="The rules of the house."
      intro={
        <p>
          The short version: be {LEGAL.minimumAge} or over and somewhere Bounce is allowed, play every shot yourself, keep your account safe, and know that blockchain
          transfers cannot be undone. The details follow.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
