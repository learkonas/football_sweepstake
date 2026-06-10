# World Cup 2026 Sweepstake Tracker

A self-contained static site to track the FIFA World Cup 2026 and the sweepstake
between **Dazzo, Cones, Burty, Bilal, and Mr Nas**. No build step, no server.

## Run it

The site is deployed on Vercel — visit the live URL and enter your name
(Dazzo / Cones / Burty / Bilal / Mr Nas) at the sign-in screen. Once you're in,
results load automatically.

To run locally, open `worldcup/index.html` directly in a browser. Everything
works offline except the ESPN results fetch, which falls back silently to the
seed data in `data.js`.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell, sign-in gate + tab navigation |
| `styles.css` | All styling |
| `app.js` | Sign-in, scoring + rendering (you shouldn't need to touch this) |
| `engine.js` | Shared logic: group standings + the bracket projector |
| `live.js` | Fetches & merges results from ESPN's public API |
| `thirds.js` | FIFA Annex C lookup (which 3rd-placed teams go where) |
| `data.js` | Teams, players, fixtures, results + config — hand-editable |

## Automatic results

Results come from **ESPN's public soccer API** — no key, no sign-up, and it's
CORS-enabled so the browser can call it directly. **One request returns all 104
matches**, including the per-team winner flag and penalty-shootout tallies, so
**knockout winners (including shootouts) are detected automatically**.

- The fetch happens **in-browser, once, right after you sign in** (there's no
  background polling and no server/cron). A status line shows the result, and a
  **Refresh** button re-pulls on demand.
- If ESPN is unreachable, it silently falls back to whatever is saved in
  `data.js`.
- Matching logic is **by team identity, so there's no fixture-id table to
  maintain.** Group games match on the team pair. For knockouts, the app
  projects each bracket slot to the two teams it should contain (from the group
  standings + feeder winners) and pairs that with the ESPN game between those
  same two teams — resolved round by round, so each round's winners feed the
  next. Kickoff dates **and times** come from ESPN too and are shown on each tie.

Settings live in `data.js → config.live`: `enabled` (set `false` for fully
manual), `url` (the ESPN endpoint/date range), and team-name `aliases`. The only
ESPN names that differ from ours are aliased already: Bosnia-Herzegovina, Congo
DR, Türkiye, Curaçao.

## Scoring rules

Per match, each team earns its owner:

- **3 pts** — win in normal time / extra time (no penalties)
- **2 pts** — win on a penalty shootout
- **1 pt** — draw after 90 minutes (a group draw, or the losing side of a shootout)
- **0 pts** — loss in 90 minutes

These live in `data.js → config.points` and can be changed.

## Deployment

The site is deployed on **Vercel**, connected to this GitHub repo. Pushes to
`main` deploy automatically. There's no build step, no server, and nothing
scheduled — every visitor's browser pulls results from ESPN when they sign in.

> Note: the sign-in is a friendly name-picker for personalisation, **not
> security** — it's all client-side, so anyone can pick any of the five names.

## Updating results manually (≈30 seconds)

Auto-updates aside, you can always edit `data.js` directly — handy for a quick
correction. Find the fixture, edit it, refresh. Add `"lock": true` to any
fixture to stop live updates from overwriting your edit.

### Group match

```js
{ "id": "G1", "group": "A", "home": "Mexico", "away": "South Africa",
  "homeScore": 2, "awayScore": 1, "played": true }
```

Set `homeScore`, `awayScore`, and flip `played` to `true`. Standings, points,
and the leaderboard all recompute automatically.

### Knockout match

The **Knockout tab draws a connected bracket top-to-bottom** — the 16
Round-of-32 ties across the top flowing down round by round to the final, with
connector lines showing the route, and each tie captioned with its kickoff date
and time. On narrow screens (phones) it switches to a **stacked, round-by-round
list** so there's no sideways scrolling. Slots fill in **automatically from the
latest results**: once a group finishes, its winner/runner-up drop into the matching
R32 slots, and each tie's winner propagates down to the next round (projected
teams show in italics until ESPN confirms them officially). When all 12 groups
finish, the **8 best third-placed teams** are ranked and slotted into the right
R32 matchups via FIFA's official Annex C table (`thirds.js`, all 495
combinations). Until a slot's team is known it shows where it comes from
(e.g. `A2`, `B2`, `3rd A/B/C/D/F`, `Winner R32-1`). Ties involving the signed-in
player's teams are highlighted.

Knockout fixtures have stable ids by bracket position (`R32-1` … `R32-16`,
`R16-1` … `R16-8`, `QF-1` … `QF-4`, `SF-1`, `SF-2`, `3P-1`, `F-1`) plus the
feeder links (`feedHome` / `feedAway`) that define the tree. ESPN fills the real
teams and results in automatically (matched by the teams in each tie, not by any
fixture id); to edit one by hand:

```js
{ "id": "R32-1", "round": "R32",
  "home": "Brazil", "away": "Scotland",
  "homeScore": 1, "awayScore": 1,
  "decided": "pens",        // "reg" | "et" | "pens"
  "winner": "Brazil",       // required when decided is "pens"
  "played": true }
```

- `decided`: `"reg"` (90 min), `"et"` (extra time), or `"pens"` (shootout).
- `winner`: ESPN provides this (incl. shootouts). For a manual `"pens"` edit set
  it yourself, since the scores are level; otherwise the higher score wins.
- The **loser of any played knockout match is auto-greyed-out** as eliminated
  across the whole site.

Knockout rounds: `R32` → `R16` → `QF` → `SF` → `3P` (third place) → `F` (final).

## Redefining the team draft

The team allocation in `data.js → players` is **dummy data** right now (9 teams
each, dealt in order; 3 teams left unallocated). Replace it with the real
sweepstake draw whenever you like — just list each player's team names exactly
as they appear in `teams`:

```js
"players": {
  "Dazzo":  ["Bosnia and Herzegovina", "Scotland", "..."],
  "Cones":  ["..."],
  "Burty":  ["..."],
  "Bilal":  ["..."],
  "Mr Nas": ["..."]
}
```

Any team not assigned to a player goes in `config.unallocated` (shown in a
separate card on the Players tab). The five names and their order come from
`config.playerOrder`.

## Notes on the data

- **Standings** apply FIFA tiebreakers: points, goal difference, goals scored,
  then **head-to-head** (a mini-league of the matches between the tied teams,
  computed from the pulled results). Disciplinary/drawing-of-lots aren't in the
  data, so an alphabetical fallback stands in for those last steps.
- **Groups** are the real, official final draw (drawn 5 Dec 2025).
- **FIFA rankings** (`teams[].rank`) are the official world ranking from the
  1 Apr 2026 update. They're shown next to each team on the Players tab, and
  each player's **average FIFA rank** is shown beneath their name. Edit the
  `rank` field on any team in `data.js` to refresh after a new ranking release.
- **Group fixtures** are the full round-robin (6 per group, 72 total). Real
  dates are synced from ESPN on sign-in; the seed dates are just a fallback.
- **Knockout fixtures** are structural placeholders (16 R32 + 8 R16 + 4 QF +
  2 SF + 1 third place + 1 final = 32). As each round resolves, ESPN fills in
  the real teams, scores, and how each tie was decided automatically.

## Manually marking a team out

If you want to grey out a team before its knockout loss is entered (e.g. a side
eliminated in the group stage), add its name to `config.eliminatedTeams`.
