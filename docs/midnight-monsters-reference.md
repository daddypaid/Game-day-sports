# Midnight Monsters reference

The user's four Midnight Monsters photos are the visual reference for this game:
the game/symbols composite, the spinning reel image, the lobby tile, and the
complete portrait game. Compare future changes against those photos at 390px.

- Moonlit castle, gargoyles, candles, green mist, metallic silver/purple/gold title.
- Five vertical reels with three visible symbols each; ornate gold frames.
- Fifteen painted symbols: Vampire, Werewolf, Zombie, Potion, Bat, Candle, Wild,
  Scatter, Spade, Club, Heart, Diamond, Skull, Book, Ring.
- Free Spins / Win / Features directly below the reels.
- Latest approved layout: enlarged, tightly packed reel pictures with no blank
  gaps between rows. Each picture scales uniformly to fill its taller cell;
  its sides crop inside the reel rather than stretching the image. Stack compact
  Total Bet and Bet Per Line panels directly under the Free Spins panel in the
  left column only. Raise Spin beneath Win and AUTO / MAX BET beneath Features,
  beside the wager panels. Keep Info in the lower action row.
- Real vertical reel movement, blur, staggered stops, reel and win sounds, mute.
- Keep GameDay bottom navigation and the test-mode/no-real-money label.

The existing castle and eight original WebP symbols remain in
`assets/midnight-monsters/`. The seven additional designs use a four-column,
two-row atlas: Spade, Club, Heart, Diamond / Skull, Book, Ring, unused.
The atlas and transparent title were generated with the supplied photos as
references, then encoded as WebP at their original dimensions for mobile use.

`gameday-midnight-monsters-v2.html` is the canonical route; the old route redirects
there. Presentation and controls are isolated in the corresponding `-game.css`
and `-game.js` files. Casino and Slots Lobby already link to this route.

Outcomes, payouts, balances, and persistent bonus sessions come from the
authenticated `themed-slots-test` function. Midnight supports $0.10–$10.00 per
line in $0.10 steps, twenty fixed paylines, and ten newly awarded free spins.
Older eight-spin sessions keep their original total. The new low-value suits
pay 1/2/4 times the line bet for 3/4/5 matches; Skull, Book, Ring pay 1/2/6.
Original monster payouts and features are preserved. All fifteen designs can
appear in settled outcomes; adding the seven symbols changes their frequencies.
Paylines pay consecutively from the leftmost reel, as shown in the game rules.

Never replace server results with animation symbols or credit a wallet in the
browser. A dropped response is reconciled by reading wallet and bonus status;
paid/free-spin requests are not retried automatically. Other games, database
schema, and settlement RPCs are outside this presentation change.
