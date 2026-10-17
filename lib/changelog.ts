// What changed on Bounce, newest first, in the players' own terms — the page
// at /whats-new reads this. Add a release at the top with each update players
// can see; the account menu counts the releases a player has not read yet.

export type ChangeKind = "new" | "improved" | "fixed";
export type Release = {
  /** The day it went out, YYYY-MM-DD. */
  date: string;
  title: string;
  summary: string;
  changes: { kind: ChangeKind; text: string }[];
};

export const RELEASES: Release[] = [
  {
    date: "2026-10-17",
    title: "Badges, a theme for testers, and your say",
    summary: "A thank-you to the players testing Bounce before it goes live, and a way to tell us what to fix next.",
    changes: [
      { kind: "new", text: "Beta tester and Founding player badges, shown beside your name on your profile and on the leaderboards." },
      { kind: "new", text: "Blueprint, a theme no one can buy: the board as it was drawn, with its own drafting-table sound. Every badge holder has it." },
      { kind: "new", text: "Two quick questions after your fifth game: how likely you are to recommend Bounce, and one thing to fix or add." },
      { kind: "new", text: "This page: every update, in one place." },
    ],
  },
  {
    date: "2026-10-15",
    title: "Ranked play",
    summary: "Public SOL matches now move a rating, season by season, with the insignia to show for it.",
    changes: [
      { kind: "new", text: "Ranked matches: win RR, lose RR. Beating a higher rank pays more, and a rout counts more than a narrow result." },
      { kind: "new", text: "Five placement matches before your rank shows, a three-loss shield after every promotion, and eight-week seasons." },
      { kind: "new", text: "Bouncer: the fifty best players of the season, numbered by their place." },
      { kind: "new", text: "A full-screen celebration when you rank up, with its own fanfare." },
      { kind: "new", text: "The ranked season on the leaderboard, and tournaments open to one band of ranks only." },
      { kind: "improved", text: "Your cashback now follows an account level that never goes down, whatever the season does to your rank." },
      { kind: "improved", text: "On a computer the whole board fits the window at full size, with no scrolling to reach the bottom." },
    ],
  },
  {
    date: "2026-10-14",
    title: "Themes with scenes, and new rank insignia",
    summary: "Every theme got a picture behind the board and a voice of its own.",
    changes: [
      { kind: "new", text: "Eight new themes, and a scene behind the board for every theme on sale: skylines, aurora, a card table and more." },
      { kind: "new", text: "Every rank redrawn as a bevelled metal insignia." },
      { kind: "improved", text: "Each theme sounds like itself, and every board stays easy to read." },
      { kind: "improved", text: "The rules and the questions are now one page." },
      { kind: "improved", text: "A tournament of a hundred players opens on a summary, with search and your own line pinned." },
      { kind: "fixed", text: "The smallest phones fit every page." },
    ],
  },
  {
    date: "2026-10-13",
    title: "Sign in with a wallet",
    summary: "Play from anywhere, and bring friends with your results.",
    changes: [
      { kind: "new", text: "Sign in with a Solana wallet: one signature, no funds moved." },
      { kind: "new", text: "A shared result or replay carries your referral code, so friends who join through it count for you." },
      { kind: "improved", text: "Stronger two-factor protection on withdrawals and large tips." },
    ],
  },
  {
    date: "2026-10-12",
    title: "Smoother money and tournaments",
    summary: "Balances that only move when money really lands, and a tournament schedule you can page through.",
    changes: [
      { kind: "improved", text: "Balances update when money actually arrives, and gems fly to your balance when you claim them." },
      { kind: "improved", text: "The tournament schedule shows a page at a time." },
    ],
  },
  {
    date: "2026-09-24",
    title: "Your own money, and tournament pages",
    summary: "Read every amount in euros or dollars, and follow a tournament by its clock and its pot.",
    changes: [
      { kind: "new", text: "Show amounts in SOL, euros or dollars, everywhere on the site." },
      { kind: "improved", text: "A tournament's page rebuilt around its clock, its pot and its field." },
      { kind: "improved", text: "Every player's last board, one click from their name." },
    ],
  },
  {
    date: "2026-09-23",
    title: "The theme shop and cashback",
    summary: "Change the board's clothes, and get part of the house fee back every week.",
    changes: [
      { kind: "new", text: "Themes: a new look and sound for the board, bought with gems or SOL. A theme never changes a shot." },
      { kind: "new", text: "Weekly and monthly cashback on the house fee, and a weekly race that pays well past the podium." },
      { kind: "improved", text: "Deeper, rounder game sounds." },
    ],
  },
  {
    date: "2026-09-21",
    title: "Friends, quests and bug reports",
    summary: "Play with people you know, come back for daily goals, and tell us when something breaks.",
    changes: [
      { kind: "new", text: "Friends: requests, messages, challenges, and blocking when you need it." },
      { kind: "new", text: "Daily gems and quests, with a streak to keep." },
      { kind: "new", text: "Referrals: bring players in and share in what they play." },
      { kind: "new", text: "Report a bug from anywhere, with a screenshot or a video attached." },
    ],
  },
];

/** The newest release's date: what a player who has read everything has seen. */
export const LATEST_RELEASE = RELEASES[0].date;

/** Releases newer than the last one this player read; the latest alone for someone who never looked. */
export const unreadReleases = (seen: string | null) => (seen ? RELEASES.filter((r) => r.date > seen).length : 1);
