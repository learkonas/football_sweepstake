# World Cup 2026 Sweepstake Tracker

A self-contained static site to track the FIFA World Cup 2026 and the sweepstake
between **Dazzo, Cones, Alex, Bilal, and Leo**. No build step, no server.

## Run it

Open `index.html` in any browser (double-click it), or host the `worldcup/`
folder on any static web server — both work. There's a sign-in screen: enter
your name (Dazzo / Cones / Alex / Bilal / Leo) and the site reveals itself. Once
you're in, results load automatically; you can also edit `data.js` by hand.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell, sign-in gate + tab navigation |
| `styles.css` | All styling |
| `app.js` | Sign-in, scoring, standings + rendering (you shouldn't need to touch this) |
| `live.js` | Fetches & merges results from ESPN's public API |
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
- Matching logic: group games match by team pair; knockout games are matched by
  ESPN's stable event id (baked into `config.live.koEventRounds`), so results
  land in the correct round even though the group and knockout date windows
  overlap and team names only resolve as the bracket fills in.

Settings live in `data.js → config.live`: `enabled` (set `false` for fully
manual), `url` (the ESPN endpoint/date range), team-name `aliases`, and
`koEventRounds` (the event-id → round map). The only ESPN names that differ from
ours are aliased already: Bosnia-Herzegovina, Congo DR, Türkiye, Curaçao.

## Scoring rules

Per match, each team earns its owner:

- **3 pts** — win in normal time / extra time (no penalties)
- **2 pts** — win on a penalty shootout
- **1 pt** — draw after 90 minutes (a group draw, or the losing side of a shootout)
- **0 pts** — loss in 90 minutes

These live in `data.js → config.points` and can be changed.

## Deploying online

The site is plain static files, so any host works (GitHub Pages, Netlify,
Vercel, S3, your own server). Upload the `worldcup/` folder — paths are all
relative, so it works from a subfolder too. Serve over **HTTPS** so the results
fetch (also HTTPS) isn't blocked as mixed content. There's no build step, no
server, and nothing scheduled: every visitor's browser pulls results from ESPN
when they sign in.

> Note: the sign-in is a friendly name-picker for personalisation, **not
> security** — it's all client-side, so anyone can pick any of the five names.
> For real access control you'd need a host-level password or a backend.

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

The **Knockout tab draws a connected bracket** — all 16 Round-of-32 ties feeding
round by round into the final, with connector lines showing the route. Until a
tie's teams are known, the slot shows where they come from (e.g. `A2`, `B2`,
`3rd A/B/C/D/F`, or `Winner R32-1`). Ties involving the signed-in player's teams
are highlighted.

Knockout fixtures have stable ids by bracket position (`R32-1` … `R32-16`,
`R16-1` … `R16-8`, `QF-1` … `QF-4`, `SF-1`, `SF-2`, `3P-1`, `F-1`) plus the
feeder links (`feedHome` / `feedAway`) that define the tree. ESPN fills the real
teams and results in automatically; to edit one by hand:

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
- **Group fixtures** are the full round-robin (6 per group, 72 total). Real
  dates are synced from ESPN on sign-in; the seed dates are just a fallback.
- **Knockout fixtures** are structural placeholders (16 R32 + 8 R16 + 4 QF +
  2 SF + 1 third place + 1 final = 32). As each round resolves, ESPN fills in
  the real teams, scores, and how each tie was decided automatically.

## Manually marking a team out

If you want to grey out a team before its knockout loss is entered (e.g. a side
eliminated in the group stage), add its name to `config.eliminatedTeams`.
