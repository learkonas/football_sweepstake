# World Cup 2026 Sweepstake Tracker

A self-contained static site to track the FIFA World Cup 2026 and the sweepstake
between **Dazzo, Cones, Alex, Bilal, and Leo**. No build step, no server.

## Run it

Open `index.html` in any browser (double-click it), or host the `worldcup/`
folder on any static web server — both work. Results update automatically (see
below); you can also edit `data.js` by hand.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell + tab navigation |
| `styles.css` | All styling |
| `app.js` | Scoring + standings + rendering (you shouldn't need to touch this) |
| `live.js` | In-browser auto-fetch of results from TheSportsDB |
| `update.js` | Node script that bakes results into `data.js` (for deployments) |
| `data.js` | Teams, players, fixtures, results + config — hand-editable |

## Automatic results

Results come from **[TheSportsDB](https://www.thesportsdb.com)** (free, no
sign-up, CORS-enabled), FIFA World Cup league `4429`, season `2026`. There are
two independent ways results stay current — use either or both:

1. **In-browser** (`live.js`): on page load and every 2 minutes, the page
   fetches the latest scores and merges them. If the API is unreachable it
   silently falls back to whatever is saved in `data.js`. A status line and a
   **Refresh** button show the state. Responses are cached for ~60s in
   `localStorage` to avoid hammering the shared key.
2. **Server-side** (`update.js` + GitHub Action): a scheduled job bakes results
   into `data.js` so a deployed site serves fresh **static** data without each
   visitor calling the API. See *Deploying online* below.

Both reuse the same matching logic: group games match by team pair; knockout
results are slotted into the bracket by their date window. Penalty-shootout
**winners** can't always be inferred from a level score — if needed, set
`winner` manually (see below).

All live settings live in `data.js → config.live` (`enabled`, `key`, `league`,
`season`, team-name `aliases`, `knockoutWindows`). Set `enabled: false` to turn
off in-browser fetching entirely. The bundled key `"3"` is TheSportsDB's shared
free key; for a busy public site you can drop in your own free key there.

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
fetch (also HTTPS) isn't blocked as mixed content.

For a public site, prefer the **server-side** updater so visitors never call the
third-party API themselves (no shared-key rate limits, no dependency on the API
being reachable from every browser):

- The included GitHub Action (`.github/workflows/wc-update-results.yml`) runs
  `node worldcup/update.js` every 15 minutes and commits the refreshed
  `data.js`. If your host auto-deploys from the repo (GitHub Pages / Netlify /
  Vercel), the live site updates on its own. Scheduled Actions run on the
  **default branch**, so merge this there to activate it.
- Run it manually anytime with `node worldcup/update.js`.

If you'd rather not run the Action, leave `config.live.enabled: true` and the
in-browser fetch keeps the page live on its own — just note every visitor's
browser then calls TheSportsDB directly.

## Updating results manually (≈30 seconds)

Auto-updates aside, you can always edit `data.js` directly — handy for fixing a
penalty-shootout winner or correcting the API. Find the fixture, edit it, refresh.
Add `"lock": true` to any fixture to stop live updates from overwriting your edit.

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
- **Group fixtures** are the full round-robin (6 per group, 72 total). A handful
  of kickoff dates are confirmed; the rest are placeholders within the correct
  matchday windows — edit the `date` field (`"YYYY-MM-DD"`) to correct any.
- **Knockout fixtures** are structural placeholders (16 R32 + 8 R16 + 4 QF +
  2 SF + 1 third place + 1 final = 32) with dates in the official windows.

## Manually marking a team out

If you want to grey out a team before its knockout loss is entered (e.g. a side
eliminated in the group stage), add its name to `config.eliminatedTeams`.
