"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateCcw } from "lucide-react";
import { MIN_DEPOSIT, PAYOUT_SHARES, STAKES, TOURNAMENT_FEE_PERCENT, winnerPayout } from "@/lib/api-types";
import { BOUNCER_FLOOR, CASHBACK_STEPS, DIVISION_RR, LAMPORTS_PER_XP, levelStart, RANK_TIERS, RANKS, rankName } from "@/lib/levels";
import { RANKED, ratingChange } from "@/lib/ranked-rules";
import { replayCoach } from "../coach";
import { RankEmblem } from "../rank-badge";
import { FactTable, LegalPage, type LegalSection } from "./legal-page";
import ladder from "./rules.module.css";

// The game rules and the questions people ask about them, on one page: how the
// board works, what a match costs and pays, and what happens when something
// goes wrong. They form part of the Terms of Use, so they are laid out like
// them. Figures that live in the code are read from it, so the page cannot
// drift from what the game does.

const SOL = 1_000_000_000;
const sol = (lamports: number) => (lamports / SOL).toLocaleString("en", { maximumFractionDigits: 9 });
const list = (items: string[]) => new Intl.ListFormat("en", { type: "disjunction" }).format(items);
const percent = (shares: readonly number[]) => shares.map((s) => `${s}%`).join(", ");
const FEE = TOURNAMENT_FEE_PERCENT.devnet;

/** Every rank's insignia, tier by tier, with what it takes to reach it. */
function RankLadder() {
  return (
    <div className={ladder.ladder}>
      {RANK_TIERS.map((tier) => {
        const steps = RANKS.filter((rank) => rank.tier === tier);
        const top = tier === "bouncer";
        return (
          <section key={tier} className={`${ladder.tier} ${ladder[tier]} ${top ? ladder.top : ""}`} aria-label={rankName(tier, null)}>
            <header>
              <b>{rankName(tier, null)}</b>
              <small>{top ? `The best ${RANKED.bouncers} this season` : `From ${steps[0].rating.toLocaleString("en")} RR`}</small>
            </header>
            <ol className={ladder.steps}>
              {steps.map((rank) => {
                const label = (
                  <>
                    <b>{rankName(rank.tier, rank.division)}</b>
                    <small>
                      {top ? (
                        <>
                          Top {RANKED.bouncers} of the season
                          <br />
                          at {BOUNCER_FLOOR.toLocaleString("en")} RR or more
                        </>
                      ) : (
                        <>{rank.tier === "diamond" && rank.division === 3 ? `${rank.rating.toLocaleString("en")} RR and up` : `${rank.rating.toLocaleString("en")}–${(rank.rating + DIVISION_RR - 1).toLocaleString("en")} RR`}</>
                      )}
                    </small>
                  </>
                );
                return (
                  <li key={rank.rating + (top ? 1 : 0)}>
                    <span className={ladder.emblem}>
                      <RankEmblem tier={rank.tier} division={rank.division} size={top ? 80 : 56} />
                    </span>
                    {top ? <div>{label}</div> : label}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** RR won and lost in a few typical matches, worked out by the game's own arithmetic. */
function rrExamples() {
  const gold3 = 11 * DIVISION_RR + 50;
  const gold1 = 9 * DIVISION_RR + 50;
  const swing = (rating: number, opponent: number, score: number, other: number) => {
    const win = ratingChange({ rating, opponent, result: 1, score: Math.max(score, other), opponentScore: Math.min(score, other), placement: false });
    const loss = ratingChange({ rating, opponent, result: 0, score: Math.min(score, other), opponentScore: Math.max(score, other), placement: false });
    return [`+${win}`, `${loss}`];
  };
  return [
    ["Same rank, a narrow result", ...swing(gold1, gold1, 1000, 950)],
    ["Same rank, a rout", ...swing(gold1, gold1, 1000, 400)],
    ["Gold 3 against Gold 1, a narrow result", ...swing(gold3, gold1, 1000, 950)],
    ["Gold 3 against Gold 1, a rout", ...swing(gold3, gold1, 1000, 400)],
    ["Gold 1 against Gold 3, a narrow result", ...swing(gold1, gold3, 1000, 950)],
  ];
}

const SECTIONS: LegalSection[] = [
  {
    id: "basics",
    title: "The game in a minute",
    body: (
      <>
        <p>
          You aim from the line at the bottom of the board and let go: your balls fly out one after another along the same angle, bounce off the walls and the bricks,
          and come back down. <strong>Every hit on a brick scores one point</strong>, and a brick breaks when its number reaches zero.
        </p>
        <p>
          In a match your opponent plays <strong>the very same board</strong> — the same bricks, in the same places, every round — in their own time. When both runs
          are over, the higher score wins.
        </p>
        <p>Practice is free and unlimited. It is played on a board of its own, counts for nothing and is not saved.</p>
      </>
    ),
  },
  {
    id: "board",
    title: "The board",
    body: (
      <>
        <FactTable
          head={["Part", "How it works"]}
          rows={[
            ["The field", "Seven columns and nine rows, 472 × 612 units. From the bottom: the ground line you launch from, rows 1 to 7, and the sky, which stays empty."],
            ["New bricks", "At the start of every round, between 1 and 7 bricks appear in row 7, one in each column chosen for that round."],
            ["Brick strength", "A brick's number is how many hits it takes. Bricks that appear in rounds 1 to 10 start at 1, 2, 3, 4, 6, 8, 10, 13, 16 and 20; after that, each round adds 4."],
            ["The end", "After every round the bricks still standing move down one row. When one reaches row 1, the run is over."],
          ]}
        />
        <h3>Balls</h3>
        <p>
          You start with one ball and earn one more every round. Clear the whole board and you earn four more on top. All your balls leave from the same spot at the
          same angle, a moment apart; the round ends when the last one is back on the ground line, and the first one to land decides where the next round is played
          from.
        </p>
      </>
    ),
  },
  {
    id: "matches",
    title: "Matches and entries",
    body: (
      <>
        <p>A match is two players, one board and one run each. Choose an entry and your run starts at once: you never wait for an opponent.</p>
        <FactTable
          head={["Currency", "Entries"]}
          rows={[
            ["Gems", `${list(STAKES.gems.map((g) => g.toLocaleString("en")))} gems`],
            ["Devnet SOL", `${list(STAKES.devnet.map(sol))} SOL`],
          ]}
        />
        <h3>Who you play</h3>
        <p>
          If somebody is already waiting at the same entry, you take the other seat on their board. If not, you open a new match and its second seat stays open:
          another player can take it while you play or after you have finished. Scores stay hidden until both runs are over.
        </p>
        <p>
          SOL matches are <Link href="#ranked">ranked</Link>: a seat goes to somebody within one tier of the player who opened it — Silver, Gold and Platinum can
          meet a Gold — and to anyone further once it has waited a while. Gem matches are open to everybody.
        </p>
        <p>To play somebody in particular, challenge them from their profile or share a challenge link: only the player you named, or someone with the link, can take that seat.</p>
        <h3>If you close the page</h3>
        <p>
          A match is saved after every shot. Come back to the arena to carry on from your last saved round. A shot that was interrupted can be played again; a shot
          that was saved can never count twice.
        </p>
      </>
    ),
  },
  {
    id: "results",
    title: "Winning, draws and forfeits",
    body: (
      <>
        <FactTable
          head={["Result", "What happens"]}
          rows={[
            ["A win in gems", `Gem matches have no fee: the winner takes both entries. Two 100-gem entries pay the winner ${winnerPayout(100, "gems")} gems, 100 more than they put in.`],
            [
              "A win in SOL",
              `The house keeps ${FEE}% of the pot and the winner receives the rest. Two 1 SOL entries pay the winner ${sol(winnerPayout(SOL, "devnet"))} SOL, ${sol(winnerPayout(SOL, "devnet") - SOL)} SOL more than they put in, and the house keeps ${sol(2 * SOL - winnerPayout(SOL, "devnet"))} SOL.`,
            ],
            ["A draw", "Equal final scores return both entries in full, with no fee."],
            ["A forfeit", "Your run ends at once and the score you have so far becomes your final score. Your entry stays in the match."],
          ]}
        />
        <h3>Forfeiting before anybody has joined</h3>
        <p>
          The match does not close: its seat stays open, and the player who takes it wins the pot by beating your score, or loses their entry to you if they score
          less. Your score only ever goes up while you play, so finishing a run is never worse than forfeiting it.
        </p>
      </>
    ),
  },
  {
    id: "time",
    title: "Time limits",
    body: (
      <ul>
        <li>
          A run with no shot for <strong>24 hours</strong> ends where it is, exactly as a forfeit would, so an opponent is never left waiting.
        </li>
        <li>
          A match nobody joins within <strong>48 hours</strong> closes, and your entry comes back in full.
        </li>
        <li>A match always settles under the rules it started with, even if the game changes in the meantime.</li>
      </ul>
    ),
  },
  {
    id: "ranked",
    title: "Ranked play",
    body: (
      <>
        <p>
          Every public SOL match is ranked. Your rank is a rating in <strong>RR</strong>, won and lost match by match, shown as one of the insignia below: three
          divisions of a hundred RR in each tier from Iron to Diamond, and Bouncer for the {RANKED.bouncers} best players of the season.
        </p>
        <h3>What a match is worth</h3>
        <p>
          Before a match, the gap between the two ratings says who is expected to win. Beat somebody ranked above you and you gain a lot; beat somebody below you and
          you gain little — and if you lose to them, you drop a lot more. The score gap counts too: a rout moves the ratings by up to half as much again as a narrow
          result, and it is measured against the scores themselves, so a board of a few hundred points counts as much as one of thousands. A draw moves nobody.
        </p>
        <FactTable head={["Match", "Win", "Loss"]} rows={rrExamples()} />
        <h3>Placement</h3>
        <p>
          Your first {RANKED.placements} ranked matches place you: they count double, and your rank shows once they are played. In every later season, the first{" "}
          {RANKED.returningPlacements} matches do the same.
        </p>
        <h3>Promotion shield</h3>
        <p>
          Reach a new division and the next {RANKED.shield} losses cannot take you back out of it. Each loss still costs RR, down to the division&apos;s floor.
        </p>
        <h3>Seasons</h3>
        <p>
          A season lasts {Math.round(RANKED.seasonMs / (7 * 86_400_000))} weeks. When a new one starts, every rating is brought halfway back to the middle of Silver and
          the placement matches begin again, so last season&apos;s best start near the top and everyone has a climb ahead. From Diamond up, two weeks without a ranked
          match costs {RANKED.decayPerDay} RR a day, never below Diamond 1.
        </p>
        <h3>What does not count</h3>
        <ul>
          <li>Gem matches, challenges between friends, tournaments and practice.</li>
          <li>More than {RANKED.repeatLimit} ranked matches against the same player in a day: the next ones move nothing.</li>
        </ul>
        <h3>The insignia</h3>
        <RankLadder />
      </>
    ),
  },
  {
    id: "tournaments",
    title: "Tournaments",
    body: (
      <>
        <p>
          In a tournament everybody plays <strong>one run on the same board</strong>, at any time between its start and its end. Registration closes when it starts.
          When it ends, the best scores share the prize pool; between equal scores, whoever finished first ranks higher.
        </p>
        <FactTable
          head={["Prize split", "Share of the pool, by place"]}
          rows={[
            ["Winner takes all", percent(PAYOUT_SHARES.winner)],
            ["Top 3", percent(PAYOUT_SHARES.top3)],
            ["Top 10", percent(PAYOUT_SHARES.top10)],
          ]}
        />
        <p>
          In a paid SOL tournament the pool is the entries less the house&apos;s {FEE}%. Gem tournaments have no fee, and the pool of a free tournament is put up by the
          house. Every tournament shows its entry, its number of places and its split before you register.
        </p>
        <h3>Tournaments by rank</h3>
        <p>
          Some tournaments are for a band of the <Link href="#ranked">ranked ladder</Link> only — Gold to Platinum, Silver and below, Bouncers only. The rank that counts
          is the one you hold when you register: climbing past the band afterwards keeps your seat. Until your placement matches are played you have no rank, so these
          tournaments wait for you to finish them.
        </p>
      </>
    ),
  },
  {
    id: "progress",
    title: "Levels, gems and rewards",
    body: (
      <>
        <h3>Gems</h3>
        <p>
          Gems are Bounce&apos;s free currency. Every new profile starts with 2,000, and the daily gems in the arena add more each day: 200 on the first day, 50 more for
          each day in a row, up to 500 from the seventh. Gems have no money value and can never be bought, sold, deposited or withdrawn.
        </p>
        <h3>Your level</h3>
        <p>
          Your level is everything you have ever staked: every 0.1 SOL of entries earns 1 XP, once the match has settled or the tournament has ended. Refunded entries
          and cancelled matches earn nothing, and gem matches earn no XP. It runs from level 1 to 60, it never goes down, and seasons never touch it — it is what
          sets your cashback, so a share once reached is yours for good.
        </p>
        <FactTable
          head={["Level", "SOL staked in all", "Weekly cashback"]}
          rows={CASHBACK_STEPS.map((step, i) => [
            `Level ${step.from}${CASHBACK_STEPS[i + 1] ? `–${CASHBACK_STEPS[i + 1].from - 1}` : ""}`,
            `${((levelStart(step.from) * LAMPORTS_PER_XP) / 1e9).toLocaleString("en")} SOL`,
            `${step.share}% of your fees${step.gems ? ", in gems" : ", in SOL"}`,
          ])}
        />
        <h3>The weekly race</h3>
        <p>
          From Monday 00:00 UTC to the next Monday, the Weekly race tab of the leaderboard ranks players by their best single score in SOL matches and paid SOL
          tournaments; gem matches and free tournaments do not count, and an earlier score wins a tie. When the week closes the scores are checked and the prizes shown
          on the race are paid straight into balances: SOL and gems for the podium, gems for the rest of the top 50.
        </p>
        <h3>Quests and cashback</h3>
        <p>
          Quests are on the Quests page, each with its own goal and reward. Cashback gives back part of the house fee you paid, at the share your level sets, and is
          claimed from your wallet every week, with a bonus at the end of a month you kept playing. Both follow the conditions shown where you claim them.
        </p>
      </>
    ),
  },
  {
    id: "watching",
    title: "Watching and replays",
    body: (
      <p>
        The Live tab lists every run being played: open one and follow it shot by shot, with the aiming that went into each. A match nobody has joined stays closed,
        and its score hidden, until somebody takes the seat; and while you still have a run to play on a board, the only run on it you can watch is your own. Finished
        games can be replayed from your history, a profile or the leaderboard.
      </p>
    ),
  },
  {
    id: "fair",
    title: "Fair boards and fair play",
    body: (
      <>
        <h3>Nobody picks your bricks</h3>
        <p>
          Every match and tournament draws a secret key before the first shot, and the bricks of each round are an HMAC-SHA256 of that key and the round number — so
          nobody, not even the house, can choose the board you get. The key&apos;s SHA-256 fingerprint is on the replay page from the start, and the key itself is revealed
          once the game is over: hash the key, compare it with the fingerprint, and if they match, the board you played is the one committed to before anyone touched
          it. The derivation is in <code>lib/secret-rows.ts</code> in the public repository.
        </p>
        <h3>Bots and cheating</h3>
        <p>
          Every shot is checked, and the game data sent to your browser carries traps only a program reading it can fall into. They are invisible, change nothing you
          see and never touch your board, your score or your payout. Automated play is suspended, its unsettled matches go to the opponent and its balance is held for
          review. Playing normally, with a mouse, a finger or the keyboard, is never affected. The full rules are under{" "}
          <Link href="/terms#fair-play">Fair play</Link> in the Terms of Use.
        </p>
      </>
    ),
  },
  {
    id: "money",
    title: "SOL, deposits and tips",
    body: (
      <>
        <p>
          While the site shows <strong>Test mode</strong>, Bounce runs on Solana devnet: its SOL is test currency with no value, kept apart from gems. Real SOL is not
          accepted yet; mainnet stays off until the real-money launch is ready.
        </p>
        <ul>
          <li>Deposits are credited once the network has finalised them. The minimum is {sol(MIN_DEPOSIT)} SOL; smaller amounts wait until the total reaches it.</li>
          <li>Withdrawals need a code from your authenticator app and go only to the address you enter. A blockchain transfer cannot be reversed.</li>
          <li>
            To tip a player, open their profile from the leaderboard or a match, choose Tip, enter an amount and check the name before confirming. Tips move SOL from
            your Bounce balance to theirs with no fee, appear in both wallets and do not count towards match results.
          </li>
        </ul>
        <p>
          Everything else about money — eligibility, limits and holds — is in the <Link href="/terms#money">Terms of Use</Link>.
        </p>
      </>
    ),
  },
];

export function RulesView() {
  const router = useRouter();
  return (
    <LegalPage
      eyebrow="GAME RULES"
      title="The rules of the bounce."
      intro={
        <p>
          Everything you need before your first run, and everything that decides a match after it. The short version: both players get the same board, every hit is a
          point, and the higher score takes the pot.
        </p>
      }
      sections={SECTIONS}
      footer={
        <>
          <p>
            Something not covered here? Ask through <strong>Report a bug</strong> at the bottom of any page.
          </p>
          <div className="row-actions">
            <Link href="/" className="btn btn-primary">
              Got it. Let’s play. <ArrowRight />
            </Link>
            {/* The guide is shown once and then stays out of the way; this asks for it back. */}
            <button
              className="btn"
              onClick={() => {
                replayCoach();
                router.push("/");
              }}
            >
              <RotateCcw size={15} /> Show me on a board
            </button>
          </div>
        </>
      }
    />
  );
}
