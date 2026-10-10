# GameDay Lucky 7s

The user's approved references show a green-and-gold sports stadium machine with three reels and three visible rows. The permanent cabinet preserves its complete portrait composition; the nine sports symbols fill the three windows as joined rows. Symbols scroll vertically with staggered reel stops, spin/stop/win sound, and a mute control. Midnight Monsters and Galactic Rebellion remain unchanged.

## Permanent artwork

- `assets/lucky-7s/stadium-cabinet.webp`: full stadium cabinet with blank live reel windows.
- `assets/lucky-7s/symbols-atlas.webp`: 3×3 square atlas, ordered red 7 / blue 7 / gold 7, football / soccer / hockey puck, basketball / boxing gloves / goalpost.

Artwork was generated using the user's two sports-machine photos as references and encoded as WebP without resizing or recoloring. The Lucky 7s game is `gameday-slots.html`; its Slots Lobby card and the Casino's Slots Lobby artwork use the same cabinet.

## Five active paylines

Every spin activates all five lines. Rows are zero-based, and each path lists one row per reel from left to right.

| Name | Path |
| --- | --- |
| Top | 0, 0, 0 |
| Middle | 1, 1, 1 |
| Bottom | 2, 2, 2 |
| Diagonal ↘ | 0, 1, 2 |
| Diagonal ↗ | 2, 1, 0 |

The paytable shows all five diagrams. Winning lines and their cells are highlighted using server-returned results.

## Initial test paytable

No payout amounts were supplied with the references. This initial test-credit paytable pays only for three identical symbols on a line: red 7 = 200×, blue 7 = 150×, gold 7 = 100×, and each sports symbol = 40× the bet per line. Multiple winning lines add together. There are no Wild, Scatter, free-spin, or two-match awards.

Total bet ranges from $0.10 to $200 in $0.10 steps; all five lines split the total equally. The nine symbols are equally likely. The theoretical expected return is exactly `690/729`, approximately 94.65%; this describes the math over many spins, not a promise for a session. The paytable can be revised when the user supplies approved payout amounts.

## Settlement and compatibility

The authenticated `slots-test` function accepts the explicit `lucky-7s` / `five-lines-v1` contract. It creates the 3×3 outcome, evaluates all five lines in integer cents, and calls the existing service-role-only `play_slot_test_spin_atomic` transaction. That transaction checks the balance and settles the shared test wallet atomically. The browser performs visual animation only and never computes a payable result or credits the wallet.

Cached clients sending the older `{stake}` request retain the deployed version-3 single-line behavior. No database schema, grants, wallet service, or other games' functions changed. Failed or uncertain paid requests are never automatically repeated; the UI reconciles through read-only wallet and game-status requests.

Focused function tests cover all 45 symbol/line awards, crossed diagonals, stake boundaries, exact expected return, authentication/error cases, and all 216 legacy outcomes. Browser checks cover mobile and installed-shell layouts, real reel animation/audio, controls, exact server rendering, errors without paid retries, and logout/navigation cancellation. PWA checks cover the version-103 cache upgrade and offline artwork.
