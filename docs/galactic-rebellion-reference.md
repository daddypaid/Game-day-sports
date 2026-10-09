# Galactic Rebellion reference

The user's complete Galactic Rebellion game photo and 15-symbol sheet are the
visual references. Compare future changes against both photos at 390px.

- Blue space, starfighters, a space station, planets, asteroids, and laser trails.
- Chrome/silver GALACTIC and gold REBELLION, with the star compass above the title.
- Five vertical reels and three visible rows, chrome/gold frames, 243 ways to win.
  The ways badges sit below the frame so the reels can use the full mobile width.
- Fifteen painted symbols: Starfighter, Space Station, Planet, Asteroid, Galaxy,
  Space Pilot, Alien Queen, Enemy Bot, Crystal Chest, Star Compass, Red Planet,
  Ringed Planet, Black Hole, Laser Cannon, Wild. The complete game also shows Scatter.
- Latest approved layout: enlarged, tightly packed reel pictures with no blank
  gaps between rows. Each picture scales uniformly to fill its taller cell;
  its sides crop inside the reel rather than stretching the image. Keep the
  atlas's painted Wild and Scatter words fully visible with a smaller, uniformly
  scaled copy over the same full-height artwork. Stack compact
  Total Bet and Bet Per Way panels directly under the Free Spins panel in the
  left column only. Keep Spin, Info, AUTO and MAX BET in the lower action row.
- Continuous vertical movement, blur, staggered reel stops, electronic spin and
  win sounds, and a mute control. Retain GameDay navigation and the test-mode label.

The permanent assets are in `assets/galactic-rebellion/`:
`space-background.webp`, `galactic-rebellion-title.webp`, and `symbols-atlas.webp`.
They were generated using the supplied photos as references and encoded as WebP
at their native dimensions. The atlas is four columns by four rows:

| Row | First | Second | Third | Fourth |
| --- | --- | --- | --- | --- |
| 1 | Starfighter | Space Station | Planet | Asteroid |
| 2 | Galaxy | Space Pilot | Alien Queen | Enemy Bot |
| 3 | Crystal Chest | Star Compass | Red Planet | Ringed Planet |
| 4 | Black Hole | Laser Cannon | Wild | Scatter |

`gameday-galactic-rebellion-v2.html` is the canonical route. The older route
redirects there. The corresponding `-game.css` and `-game.js` isolate presentation
and controls from Midnight Monsters and other games. Casino and Slots Lobby link
to this route and display its 243-way metadata.

Authenticated `themed-slots-test` responses supply settled symbols, payouts,
balances, the current paytable, and persistent free-spin sessions. New paid spins
use $0.10–$200.00 total bets in $0.10 steps, default $1.00, and all 243 ways. The
per-way unit is total bet divided by 243. Wager panels both adjust the total by
$0.10; the second shows the corresponding unit. Three matching symbols start
paying consecutively from the leftmost reel, using any row. Wild substitutes
except for Scatter. Overlapping Wild matches pay the best nonoverlapping
combination. Unmatched later reels do not duplicate a three- or four-reel win.
The game rules display the service's payout multipliers.

Existing Rebel Strike and Final Orbit features remain: an expanded Wild reel,
six awarded free spins, and Final Orbit's 2× payout multiplier. There is no new
jackpot or crystal-collection payout; those decorative reference tiles do not
introduce settlement rules. Three or more Scatter symbols award the existing
six-spin bonus and pay count × 10 × the unit wager before the feature multiplier.

Previously captured Galactic bonuses preserve their original eight symbols,
twenty paylines, integer $1–$10 per-line wager, and six-spin rules. Their UI
shows Bet Per Line and 20 paylines while the bonus is active. New sessions store
the per-way unit below $1; the $200 total cap keeps it disjoint from legacy units.
The existing numeric storage and settlement RPCs are unchanged. Legacy API
requests using `bet_per_line` also retain their original paid-spin math.

Never substitute animation symbols for server results or credit wallets in the
browser. Interrupted responses are reconciled through read-only wallet and bonus
status; paid/free-spin requests are never automatically retried. Authentication,
ownership checks, and atomic settlement stay on the service. No schema changes,
unrelated game changes, or real-money features are part of this work.
