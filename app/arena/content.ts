export const FAQ: [question: string, answer: string][] = [
  [
    "How does Bounce work?",
    "Choose an entry amount, then aim your balls at the bricks. Every hit adds one point. Your opponent plays the same seed, with identical brick spawns and starting conditions. The higher final score wins.",
  ],
  [
    "Do I have to wait for an opponent?",
    "No. Your run starts immediately. If nobody has entered at your amount, the second seat stays open. Another player can join while you play or after you finish. Scores are hidden until both players finish. There is no automatic expiry in this development version.",
  ],
  [
    "How much does the winner receive?",
    "Gem matches have no house fee: the winner receives both entries in full. Two 100-gem entries pay the winner 200 gems, a net profit of 100 gems. In devnet SOL matches, the house fee is 12% of each entry when a match resolves with a winner. The winner receives 88% of the combined entries: for two 1 SOL entries, the payout is 1.76 SOL, the winner’s net profit is 0.76 SOL, and the house receives 0.24 SOL. All amounts in this development version are gems or devnet test SOL.",
  ],
  [
    "What happens in a draw or a forfeit?",
    "Equal final scores return both entries in full, with no house fee. Forfeiting ends your run immediately: your score so far becomes your final score and your entry stays in the match. If nobody has joined yet, the seat stays open, and the player who takes it wins the pot by beating your score, or loses their entry to you if they score less. Your score can only grow while you play, so finishing a run is never worse than forfeiting it.",
  ],
  [
    "How are rounds and extra balls handled?",
    "You begin with one ball. All balls launch from the same position and at the same angle, with a short delay between them. The round ends when all balls return to the ground line. The first ball to return sets the next launch position. You earn one ball each round, plus four extra if you clear the whole board.",
  ],
  [
    "Where do bricks appear?",
    "The playfield is 472 × 612 units, with seven columns and nine rows. From bottom to top: ground, rows 1 through 7, and sky. Coordinates are column:row. At the start of each round, 1–7 bricks spawn in row 7, one per chosen column. New bricks have HP equal to the round number. Surviving bricks descend one row; reaching row 1 ends your game. Sky stays empty.",
  ],
  [
    "What are gems?",
    "Gems are Bounce’s free in-game currency. Every new profile receives 2,000 gems to enter gem matches. They have no monetary value and cannot be bought, sold, deposited or withdrawn.",
  ],
  [
    "Do you check for bots?",
    "Yes. Every shot is checked, and the game data sent to your browser carries traps that only a program reading it can fall into. They are invisible, change nothing you see and never touch your board, your score or your payout. Automated play is suspended, its unsettled matches go to the opponent and its balance is held for review. Playing normally, with your mouse or your keyboard, is never affected.",
  ],
  [
    "What is the weekly race?",
    "Every week, from Monday 00:00 UTC to the next Monday, the leaderboard's Weekly race tab ranks players by their best single score in devnet SOL matches and paid SOL tournaments. Gem matches and free tournaments do not count, and an earlier score wins a tie. When the week closes, the scores are reviewed and the top 3 receive SOL and gem prizes, shown on the race page, straight into their balances.",
  ],
  [
    "How do ranks work?",
    "Every 0.1 SOL you wager earns 1 XP, once the match is settled or the tournament has ended. Refunded entries and cancelled matches earn nothing, and gem matches earn no XP. The ranks are Iron, Bronze, Silver, Gold, Platinum and Diamond, each split into 1, 2 and 3, then Bouncer at the top. Bronze 1 starts at 50 XP (5 SOL wagered), Silver 1 at 400 XP (40 SOL), Gold 1 at 3,000 XP (300 SOL), Platinum 1 at 25,000 XP (2,500 SOL), Diamond 1 at 200,000 XP (20,000 SOL) and Bouncer at 1,000,000 XP (100,000 SOL). XP never goes down, whether you win or lose.",
  ],
  [
    "How do I tip another player?",
    "Open their profile from the leaderboard or a match, or find them by name on the leaderboard. Select Tip, enter a devnet SOL amount, and review the recipient before confirming. Tips move your available Bounce wallet balance to theirs without a tip fee. Sent and received tips appear in your wallet and do not affect match PNL.",
  ],
  [
    "Can I deposit or withdraw real SOL?",
    "Real SOL is not accepted. When the development payment service is configured, your wallet can receive and withdraw Solana devnet test SOL, which is separate from gems. Mainnet stays disabled until the real-money launch is ready.",
  ],
  [
    "What if I close the page?",
    "Matches save after each completed shot. Return to the arena to resume your last saved round. An interrupted shot can be replayed after reload; a successfully saved shot cannot be scored twice. Practice sessions are not saved.",
  ],
  [
    "Is the game ready for real-money competition?",
    "No. The development version has server-verified shots and devnet payment accounting. Public account access, production custody, independent security review, competition integrity measures, and launch eligibility controls still need to be completed.",
  ],
];

export const HOW_TO_STEPS: [title: string, description: string][] = [
  ["Pick your angle", "Aim, release, watch the chain reaction."],
  ["Stack your score", "Every brick hit earns one point."],
  ["Outplay your opponent", "Higher score takes the pot."],
];
