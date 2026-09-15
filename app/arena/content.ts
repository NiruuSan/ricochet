export const FAQ: [question: string, answer: string][] = [
  [
    "How does Ricochet work?",
    "Choose an entry amount, then aim your balls at the bricks. Every hit adds one point. Your opponent plays the same seed, with identical brick spawns and starting conditions. The higher final score wins.",
  ],
  [
    "Do I have to wait for an opponent?",
    "No. Your run starts immediately. If nobody has entered at your amount, the second seat stays open. Another player can join while you play or after you finish. Scores are hidden until both players finish. There is no automatic expiry in this development version.",
  ],
  [
    "How much does the winner receive?",
    "The house fee is 12% of each entry, charged only when a match resolves with a winner. The winner receives 88% of the combined entries: for two 1 SOL entries, the payout is 1.76 SOL, the winner’s net profit is 0.76 SOL, and the house receives 0.24 SOL. Gem matches work the same way in gems. All amounts in this development version are gems or devnet test SOL.",
  ],
  [
    "What happens in a draw or a forfeit?",
    "Equal final scores return both entries in full, with no house fee. If one player forfeits, the other wins once their run finishes. If both forfeit, scores decide, with equal scores refunded. If you forfeit before anyone has joined your match, it closes: nobody can take the seat, and your entry is refunded minus the 12% house fee.",
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
    "Gems are Ricochet’s free in-game currency. Every new profile receives 2,000 gems to enter gem matches. They have no monetary value and cannot be bought, sold, deposited or withdrawn.",
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
