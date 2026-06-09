# World Cup 2026 Sweepstake Tracker

A self-contained static site to track the FIFA World Cup 2026 and the sweepstake
between **Dazzo, Cones, Alex, Bilal, and Leo**. No build step, no server.

## Run it

Just open `index.html` in any browser (double-click it). Everything is loaded
from local files — there is no fetch/CORS, so `file://` works fine.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell + tab navigation |
| `styles.css` | All styling |
| `app.js` | Scoring + standings + rendering (you shouldn't need to touch this) |
| `data.js` | **The only file you edit** — teams, players, fixtures, results |

## Scoring rules

Per match, each team earns its owner:

- **3 pts** — win in normal time / extra time (no penalties)
- **2 pts** — win on a penalty shootout
- **1 pt** — draw after 90 minutes (a group draw, or the losing side of a shootout)
- **0 pts** — loss in 90 minutes

These live in `data.js → config.points` and can be changed.

## Updating results (≈30 seconds)

Open `data.js` and find the fixture, then refresh the page.

### Group match

```js
{ "id": "G1", "group": "A", "home": "Mexico", "away": "South Africa",
  "homeScore": 2, "awayScore": 1, "played": true }
```

Set `homeScore`, `awayScore`, and flip `played` to `true`. Standings, points,
and the leaderboard all recompute automatically.

### Knockout match

Knockouts start as `"TBD" vs "TBD"` placeholders. As each round resolves, fill
in the real team names plus the result:

```js
{ "id": "KO1", "round": "R32",
  "home": "Brazil", "away": "Scotland",
  "homeScore": 1, "awayScore": 1,
  "decided": "pens",        // "reg" | "et" | "pens"
  "winner": "Brazil",       // required when decided is "pens"
  "played": true }
```

- `decided`: `"reg"` (90 min), `"et"` (extra time), or `"pens"` (shootout).
- `winner`: only needed for `"pens"` (scores are level); otherwise the higher
  score wins automatically.
- The **loser of any played knockout match is auto-greyed-out** as eliminated
  across the whole site.

Knockout rounds: `R32` → `R16` → `QF` → `SF` → `3P` (third place) → `F` (final).

## Redefining the team draft

The team allocation in `data.js → players` is **dummy data** right now (8 teams
each, dealt in order). Replace it with the real sweepstake draw whenever you
like — just list each player's 8 team names exactly as they appear in `teams`:

```js
"players": {
  "Dazzo": ["Brazil", "Japan", "..."],
  "Cones": ["..."],
  "Alex":  ["..."],
  "Bilal": ["..."],
  "Leo":   ["..."]
}
```

Any team not assigned to a player goes in `config.unallocated` (shown in a
separate card on the Players tab). The five names and their order come from
`config.playerOrder`.

## Notes on the data

- **Groups** are the real, official final draw (drawn 5 Dec 2025).
- **Group fixtures** are the full round-robin (6 per group, 72 total). A handful
  of kickoff dates are confirmed; the rest are placeholders within the correct
  matchday windows — edit the `date` field (`"YYYY-MM-DD"`) to correct any.
- **Knockout fixtures** are structural placeholders (16 R32 + 8 R16 + 4 QF +
  2 SF + 1 third place + 1 final = 32) with dates in the official windows.

## Manually marking a team out

If you want to grey out a team before its knockout loss is entered (e.g. a side
eliminated in the group stage), add its name to `config.eliminatedTeams`.
