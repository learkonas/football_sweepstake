/* World Cup 2026 Sweepstake tracker — all rendering & scoring logic.
   No build step, no framework. Reads window.WC_DATA from data.js. */
(function () {
  "use strict";

  const D = window.WC_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:2rem'>data.js failed to load.</p>"; return; }

  const PTS = D.config.points;
  const PLAYERS = D.config.playerOrder;
  let ME = null; // the signed-in player
  // How each player's team list is ordered on the Players tab.
  const PSORT_KEY = "wc_player_sort";
  const PSORTS = ["points", "alpha", "fifa"];
  let playerSort = PSORTS.includes(localStorage.getItem(PSORT_KEY)) ? localStorage.getItem(PSORT_KEY) : "points";
  const PLAYER_COLORS = ["#e63946", "#2a9d8f", "#e9a020", "#5b6cf0", "#9b5de5"];
  const colorFor = (p) => PLAYER_COLORS[PLAYERS.indexOf(p) % PLAYER_COLORS.length];

  // ---- lookups ----
  const teamGroup = {};
  const teamRank = {};
  D.teams.forEach((t) => { teamGroup[t.name] = t.group; teamRank[t.name] = t.rank; });

  const ownerOf = {};
  Object.keys(D.players).forEach((p) => D.players[p].forEach((t) => { ownerOf[t] = p; }));

  const allFixtures = D.groupFixtures.concat(D.knockoutFixtures);

  // A team is eliminated if manually flagged OR it lost a knockout match — a
  // confirmed result, or a live one it's currently behind in (provisional, and
  // cleared again by recompute if the in-play score swings back).
  const eliminated = new Set(D.config.eliminatedTeams || []);
  D.knockoutFixtures.forEach((f) => {
    if (!(f.played || f.live)) return;
    const r = matchResult(f, true);
    if (r.loser && r.loser !== "TBD") eliminated.add(r.loser);
  });
  const isEliminated = (t) => eliminated.has(t);

  // ---- scoring ----
  // A fixture contributes to the sweepstake points the moment it has a score:
  // confirmed (played) results and live in-play scores alike. Live points are
  // provisional and swing with the running score until the match is confirmed.
  const counts = (f) => f.played || f.live;

  // Returns { winner, loser, draw, homePts, awayPts } for a scored fixture.
  function matchResult(f, knockout) {
    const hs = f.homeScore, as = f.awayScore;
    if (knockout) {
      if (f.decided === "pens") {
        // level after 90/ET, decided on penalties: winner 2pts, loser 1pt (drew after 90)
        const winner = f.winner || (hs > as ? f.home : as > hs ? f.away : null);
        const loser = winner ? (winner === f.home ? f.away : f.home) : null;
        return {
          winner, loser, draw: false,
          homePts: winner === f.home ? PTS.penWin : winner ? PTS.draw : 0,
          awayPts: winner === f.away ? PTS.penWin : winner ? PTS.draw : 0,
          kind: winner === f.home ? ["penWin", "penLoss"] : winner === f.away ? ["penLoss", "penWin"] : ["draw", "draw"],
        };
      }
      // decided in regulation or extra time: win = 3, loss = 0
      const winner = hs > as ? f.home : as > hs ? f.away : (f.winner || null);
      const loser = winner ? (winner === f.home ? f.away : f.home) : null;
      return {
        winner, loser, draw: false,
        homePts: winner === f.home ? PTS.win : winner ? PTS.loss : 0,
        awayPts: winner === f.away ? PTS.win : winner ? PTS.loss : 0,
        kind: winner === f.home ? ["win", "loss"] : winner === f.away ? ["loss", "win"] : ["draw", "draw"],
      };
    }
    // group stage
    if (hs > as) return { winner: f.home, loser: f.away, draw: false, homePts: PTS.win, awayPts: PTS.loss, kind: ["win", "loss"] };
    if (as > hs) return { winner: f.away, loser: f.home, draw: false, homePts: PTS.loss, awayPts: PTS.win, kind: ["loss", "win"] };
    return { winner: null, loser: null, draw: true, homePts: PTS.draw, awayPts: PTS.draw, kind: ["draw", "draw"] };
  }

  // ---- player stats ----
  function playerStats() {
    const stats = {};
    PLAYERS.forEach((p) => {
      stats[p] = { pts: 0, win: 0, penWin: 0, draw: 0, loss: 0, penLoss: 0, alive: 0, gf: 0, ga: 0, teamPts: {} };
      D.players[p].forEach((t) => { stats[p].teamPts[t] = 0; if (!isEliminated(t)) stats[p].alive++; });
    });

    function award(team, pts, kind) {
      const p = ownerOf[team];
      if (!p) return;
      stats[p].pts += pts;
      stats[p].teamPts[team] += pts;
      stats[p][kind]++;
    }

    // Goals for/against go to a team's owner from the 90/ET scoreline (penalty
    // shootouts don't count as goals), feeding the player goal-difference tiebreak.
    function addGoals(team, gf, ga) {
      const p = ownerOf[team];
      if (!p || typeof gf !== "number" || typeof ga !== "number") return;
      stats[p].gf += gf;
      stats[p].ga += ga;
    }

    D.groupFixtures.forEach((f) => {
      if (!counts(f)) return;
      const r = matchResult(f, false);
      award(f.home, r.homePts, r.kind[0]);
      award(f.away, r.awayPts, r.kind[1]);
      addGoals(f.home, f.homeScore, f.awayScore);
      addGoals(f.away, f.awayScore, f.homeScore);
    });
    D.knockoutFixtures.forEach((f) => {
      if (!counts(f) || f.home === "TBD" || f.away === "TBD") return;
      const r = matchResult(f, true);
      award(f.home, r.homePts, r.kind[0]);
      award(f.away, r.awayPts, r.kind[1]);
      addGoals(f.home, f.homeScore, f.awayScore);
      addGoals(f.away, f.awayScore, f.homeScore);
    });
    return stats;
  }

  // ---- team league table ----
  // Sweepstake points accrued by every team across all played matches (group +
  // knockout), independent of who drew them. Same scoring as the leaderboard.
  function teamStats() {
    const stats = {};
    D.teams.forEach((t) => {
      stats[t.name] = { team: t.name, group: t.group, rank: t.rank, pts: 0, P: 0, win: 0, penWin: 0, draw: 0, loss: 0, penLoss: 0 };
    });

    function award(team, pts, kind) {
      const s = stats[team];
      if (!s) return;
      s.pts += pts; s.P++; s[kind]++;
    }

    D.groupFixtures.forEach((f) => {
      if (!counts(f)) return;
      const r = matchResult(f, false);
      award(f.home, r.homePts, r.kind[0]);
      award(f.away, r.awayPts, r.kind[1]);
    });
    D.knockoutFixtures.forEach((f) => {
      if (!counts(f) || f.home === "TBD" || f.away === "TBD") return;
      const r = matchResult(f, true);
      award(f.home, r.homePts, r.kind[0]);
      award(f.away, r.awayPts, r.kind[1]);
    });
    return stats;
  }

  // ---- group standings (FIFA tiebreakers incl. head-to-head) live in engine.js ----
  const groupStandings = (g) => window.WC_ENGINE.groupStandings(D, g);

  // ---- formatting ----
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s + "T00:00:00");
    return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  }
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Kickoff label for a fixture: date (+ time when we have an exact timestamp).
  function fmtKick(f) {
    if (f.kickoff) {
      const d = new Date(f.kickoff);
      return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${fmtTime(f.kickoff)}`;
    }
    return fmtDate(f.date);
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  // Match-centre kickoff: date on one line, time (when known) on a second, so the
  // column stays narrow and leaves room for long team names.
  function mcWhen(f) {
    if (f.kickoff) {
      const d = new Date(f.kickoff);
      return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}<small>${esc(fmtTime(f.kickoff))}</small>`;
    }
    return f.date ? esc(fmtDate(f.date)) : "";
  }

  // Badge initial overrides for players whose displayed letter differs from
  // the first character of their name.
  const OWNER_INITIAL = { "Mr Nas": "L" };
  function ownerTag(team) {
    const p = ownerOf[team];
    if (!p) return "";
    return `<span class="owner" style="background:${colorFor(p)}" title="${esc(p)}">${esc(OWNER_INITIAL[p] || p[0])}</span>`;
  }
  // ownerAfter puts the owner badge on the trailing edge (name then badge), used
  // for the right-aligned home side so its badge sits next to the score.
  function teamLabel(team, noOwner, ownerAfter) {
    if (!team || team === "TBD") return `<span class="team tbd">${esc(team || "TBD")}</span>`;
    const cls = isEliminated(team) ? "team out" : "team";
    const own = noOwner ? "" : ownerTag(team);
    const nm = `<span class="tnm">${esc(team)}</span>`;
    return `<span class="${cls}">${ownerAfter ? nm + own : own + nm}</span>`;
  }

  // ---- renderers ----
  const MEDALS = ["🥇", "🥈", "🥉"];
  function renderLeaderboard() {
    const stats = playerStats();
    const ranked = PLAYERS.slice().sort((a, b) =>
      stats[b].pts - stats[a].pts
      || (stats[b].gf - stats[b].ga) - (stats[a].gf - stats[a].ga)
      || stats[b].gf - stats[a].gf
      || stats[b].win - stats[a].win
      || stats[b].alive - stats[a].alive);
    const rows = ranked.map((p, i) => {
      const s = stats[p];
      const rank = MEDALS[i] ? `<span class="medal">${MEDALS[i]}</span>` : i + 1;
      return `<tr class="${p === ME ? "me" : ""} ${i === 0 ? "leader" : ""}">
        <td class="rank">${rank}</td>
        <td class="pname"><span class="pname-box"><span class="pchip" style="background:${colorFor(p)}"></span><span>${esc(p)}</span></span></td>
        <td class="pts">${s.pts}</td>
        <td>${s.win}</td><td>${s.penWin}</td><td>${s.draw + s.penLoss}</td><td>${s.loss}</td>
        <td>${s.alive}/${D.players[p].length}</td>
      </tr>`;
    }).join("");
    return `<table class="board">
      <thead><tr>
        <th>#</th><th>Player</th><th>Pts</th>
        <th title="Wins (no pens)">W</th><th title="Penalty shootout wins">PW</th>
        <th title="Draws after 90 / shootout losses">D</th><th title="Losses in 90">L</th>
        <th title="Teams still in the tournament">Alive</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="rules">Scoring: <b>${PTS.win}</b> win &middot; <b>${PTS.penWin}</b> shootout win &middot; <b>${PTS.draw}</b> draw after 90 &middot; <b>${PTS.loss}</b> loss in 90.</p>
      ${renderMatchCentre()}`;
  }

  // League: every team ranked by the sweepstake points it has accrued. Ties
  // break on wins, then shootout wins, then fewest games played, then name.
  function renderLeague() {
    const stats = teamStats();
    const ranked = D.teams.map((t) => stats[t.name]).sort((a, b) =>
      b.pts - a.pts || b.win - a.win || b.penWin - a.penWin || a.P - b.P || a.team.localeCompare(b.team));
    const rows = ranked.map((s, i) => `<tr class="${ownerOf[s.team] === ME ? "mine" : ""}">
      <td class="rank">${i + 1}</td>
      <td class="tname">${teamLabel(s.team)} <small class="grp">#${s.rank != null ? s.rank : "–"}</small></td>
      <td>${s.P}</td>
      <td class="pts">${s.pts}</td>
      <td>${s.win}</td><td>${s.penWin}</td><td>${s.draw + s.penLoss}</td><td>${s.loss}</td>
    </tr>`).join("");
    return `<table class="board league">
      <thead><tr>
        <th>#</th><th class="tname">Team</th>
        <th title="Matches played">P</th><th>Pts</th>
        <th title="Wins (no pens)">W</th><th title="Penalty shootout wins">PW</th>
        <th title="Draws after 90 / shootout losses">D</th><th title="Losses in 90">L</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="rules">Every team ranked by sweepstake points: <b>${PTS.win}</b> win &middot; <b>${PTS.penWin}</b> shootout win &middot; <b>${PTS.draw}</b> draw after 90 &middot; <b>${PTS.loss}</b> loss in 90. Badges show the owner; eliminated teams are greyed out.</p>`;
  }

  // Once results are fetched a fixture carries its ESPN game id; this stamps it
  // onto the row so a click can open that match on ESPN. No-op (and invisible)
  // until live data has matched the fixture.
  function espnAttr(f) {
    if (!f.espnId) return "";
    // Attribute context: also escape quotes so a stray quote in the (remote)
    // id can't break out of data-espn="…" and inject extra attributes.
    const v = String(f.espnId).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return ` data-espn="${v}"`;
  }

  // Compact match row for the leaderboard's match centre. Resolves knockout
  // teams via the projector; group teams are already known.
  function mcRow(f, P) {
    const ko = f.round != null;
    const H = ko ? P.side(f, "home") : { team: f.home, proj: false };
    const A = ko ? P.side(f, "away") : { team: f.away, proj: false };
    const mine = ME && (ownerOf[H.team] === ME || ownerOf[A.team] === ME);
    // Names without the inline owner badge; we place each badge on the inner
    // edge (next to the score) ourselves so the home side reads "Team Ⓞ".
    const sh = bracketSideHtml(f, H, "home", "", "bdg", true);
    const sa = bracketSideHtml(f, A, "away", "", "bdg", true);
    const ownH = ownerTag(H.team), ownA = ownerTag(A.team);
    const isLive = !!f.live;
    const sc = (f.played || isLive) ? `${f.homeScore}&ndash;${f.awayScore}` : "v";
    const tag = ko ? (ROUND_TAG[f.round] || f.round) : `Group ${f.group}`;
    const today = f.date === todayStr() ? " today" : "";
    const liveBadge = isLive ? `<span class="mc-live">${esc(f.liveDetail || "LIVE")}</span>` : "";
    return `<div class="mc-row ${f.played ? "done" : ""} ${isLive ? "live" : ""} ${mine ? "mine" : ""}${today}"${espnAttr(f)}>
      <span class="mc-when">${mcWhen(f)}${liveBadge}</span>
      <span class="mc-tag">${esc(tag)}</span>
      <span class="mc-match">
        <span class="mc-side ${sh.isWin ? "win" : ""}">${sh.label}${ownH}</span>
        <span class="mc-sc">${sc}${sh.badge || sa.badge}</span>
        <span class="mc-side ${sa.isWin ? "win" : ""}">${ownA}${sa.label}</span>
      </span>
    </div>`;
  }

  function renderMatchCentre() {
    const P = window.WC_ENGINE.projector(D);
    const all = D.groupFixtures.concat(D.knockoutFixtures);
    const live = all.filter((f) => f.live).sort((a, b) => whenOf(a) - whenOf(b));
    const played = all.filter((f) => f.played).sort((a, b) => whenOf(b) - whenOf(a));
    const upcoming = all.filter((f) => !f.played && !f.live && f.date).sort((a, b) => whenOf(a) - whenOf(b));
    // Live matches lead the results column so the in-play score is the first thing you see.
    const results = live.concat(played).slice(0, 6).map((f) => mcRow(f, P)).join("") || `<p class="mc-empty">No results in yet — kicks off ${esc(fmtDate(D.groupFixtures[0] && D.groupFixtures[0].date))}.</p>`;
    const next = upcoming.slice(0, 6).map((f) => mcRow(f, P)).join("") || `<p class="mc-empty">Tournament complete 🏆</p>`;
    return `<div class="matchcentre">
      <section class="mc-col"><h3>Latest results</h3>${results}</section>
      <section class="mc-col"><h3>Coming up</h3>${next}</section>
    </div>`;
  }

  function renderGroups() {
    const cards = Object.keys(WC_GROUPS()).map((g) => {
      const standings = groupStandings(g);
      const srows = standings.map((r, i) => `<tr class="${i < 2 ? "qual" : i === 2 ? "third" : ""}">
        <td class="tname">${teamLabel(r.team)}</td>
        <td>${r.P}</td><td>${r.W}</td><td>${r.Dr}</td><td>${r.L}</td>
        <td>${r.GD > 0 ? "+" + r.GD : r.GD}</td><td class="pts">${r.Pts}</td>
      </tr>`).join("");
      const fixtures = D.groupFixtures.filter((f) => f.group === g)
        .sort((a, b) => a.matchday - b.matchday || a.date.localeCompare(b.date))
        .map((f) => fixtureRow(f, false)).join("");
      return `<section class="card">
        <h3>Group ${g}</h3>
        <table class="standings">
          <thead><tr><th class="tname">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${srows}</tbody>
        </table>
        <div class="fixtures">${fixtures}</div>
      </section>`;
    }).join("");
    return `<div class="groups-wrap">
      <button class="gnav prev" type="button" aria-label="Previous groups">&lsaquo;</button>
      <div class="hscroll groups-scroll">${cards}</div>
      <button class="gnav next" type="button" aria-label="Next groups">&rsaquo;</button>
    </div>`;
  }

  // Mobile arrows for the group scroller: step by one card width and reflect the
  // scroll position in the buttons' disabled state.
  function wireGroupsNav() {
    const wrap = content.querySelector(".groups-wrap");
    if (!wrap) return;
    const scroller = wrap.querySelector(".groups-scroll");
    const prev = wrap.querySelector(".gnav.prev");
    const next = wrap.querySelector(".gnav.next");
    if (!scroller || !prev || !next) return;
    const step = () => {
      const card = scroller.querySelector(".card");
      const cs = getComputedStyle(scroller);
      const gap = parseFloat(cs.columnGap || cs.gap) || 16;
      return card ? card.getBoundingClientRect().width + gap : scroller.clientWidth * 0.8;
    };
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth - 2;
      prev.disabled = scroller.scrollLeft <= 0;
      next.disabled = scroller.scrollLeft >= max;
    };
    prev.addEventListener("click", () => scroller.scrollBy({ left: -step(), behavior: "smooth" }));
    next.addEventListener("click", () => scroller.scrollBy({ left: step(), behavior: "smooth" }));
    scroller.addEventListener("scroll", update, { passive: true });
    update();
  }

  // Players tab: the segmented control that re-orders every player's team list.
  function wirePlayersSort() {
    const bar = content.querySelector(".psort");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".psort-btn");
      if (!btn) return;
      const k = btn.dataset.sort;
      if (k === playerSort || !PSORTS.includes(k)) return;
      playerSort = k;
      try { localStorage.setItem(PSORT_KEY, k); } catch (_) {}
      content.innerHTML = views.players();
      wirePlayersSort();
    });
  }

  // Desktop bracket: a styled tooltip that follows the cursor over a tie, showing
  // the round, kickoff time, and how each side reaches the match.
  function wireBracketTips() {
    const wrap = content.querySelector(".bracket2-wrap");
    if (!wrap) return;
    let tip = document.getElementById("bxtip");
    if (!tip) { tip = document.createElement("div"); tip.id = "bxtip"; tip.className = "bxtip"; document.body.appendChild(tip); }
    let active = null;
    const place = (e) => {
      const pad = 14, r = tip.getBoundingClientRect();
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - pad - r.width;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - pad - r.height;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.max(8, y) + "px";
    };
    wrap.addEventListener("mouseover", (e) => {
      const bx = e.target.closest(".bx");
      if (!bx || bx === active) return;
      active = bx;
      const round = bx.getAttribute("data-tround") || "";
      const when = bx.getAttribute("data-twhen") || "";
      const home = bx.getAttribute("data-thome") || "";
      const away = bx.getAttribute("data-taway") || "";
      tip.innerHTML = `<div class="bxtip-h">${esc(round)}${when ? `<span class="bxtip-when">${esc(when)}</span>` : ""}</div>
        <div class="bxtip-paths"><div>${esc(home)}</div><div>${esc(away)}</div></div>`;
      tip.classList.add("show");
      place(e);
    });
    wrap.addEventListener("mousemove", (e) => { if (active) place(e); });
    wrap.addEventListener("mouseout", (e) => {
      if (active && !active.contains(e.relatedTarget)) { active = null; tip.classList.remove("show"); }
    });
  }

  function fixtureRow(f, knockout) {
    const played = f.played;
    const isLive = !!f.live;
    const score = (played || isLive) ? `${f.homeScore}&ndash;${f.awayScore}` : "v";
    let badge = "";
    if (knockout && played && f.decided) {
      const label = f.decided === "pens" ? "pens" : f.decided === "et" ? "AET" : "";
      if (label) badge = `<span class="decided">${label}</span>`;
    }
    const liveBadge = isLive ? `<small class="fx-live">${esc(f.liveDetail || "LIVE")}</small>` : "";
    return `<div class="fx ${played ? "done" : ""} ${isLive ? "live" : ""}"${espnAttr(f)}>
      <span class="date">${fmtDate(f.date)}${f.kickoff ? `<small>${fmtTime(f.kickoff)}</small>` : ""}${liveBadge}</span>
      <span class="side home">${teamLabel(f.home, false, true)}</span>
      <span class="score">${score}${badge}</span>
      <span class="side away">${teamLabel(f.away)}</span>
    </div>`;
  }

  const ROUND_TITLE = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals", SF: "Semi-finals", "3P": "Third place", F: "Final" };
  const ROUND_SHORT = { R32: "R32", R16: "R16", QF: "QF", SF: "SF", F: "Final" };
  const ROUND_TAG = { R32: "R32", R16: "R16", QF: "QF", SF: "SF", "3P": "3rd place", F: "Final" };

  // Human-readable "how this slot gets filled", for the bracket hover tooltip:
  // group finish ("A1"), a best-third slot, or the feeder match a winner/loser
  // advances from ("Winner R32-3").
  function srcText(src) {
    if (!src) return "TBD";
    let m = /^([A-L])([12])$/.exec(src);
    if (m) return `${m[2] === "1" ? "Winner" : "Runner-up"} of Group ${m[1]}`;
    m = /^3rd\s+(.+)$/.exec(src);
    if (m) return `Best 3rd place (from ${m[1]})`;
    m = /^(Winner|Loser)\s+(.+)$/.exec(src);
    if (m) return `${m[1]} of ${m[2]}`;
    return src;
  }

  // Today (local) as YYYY-MM-DD, and a sortable kickoff time for any fixture.
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const whenOf = (f) => new Date(f.kickoff || ((f.date || "9999-12-31") + "T12:00:00")).getTime();

  // One side of a tie, as HTML: team (italic if projected) or its source label,
  // plus the score and an aet/pens badge on the winner. Shared by both layouts.
  function bracketSideHtml(f, S, which, scoreCls, badgeCls, noOwner) {
    const score = f.played ? (which === "home" ? f.homeScore : f.awayScore) : "";
    const isWin = f.played && S.team && (f.winner ? f.winner === S.team
      : which === "home" ? f.homeScore > f.awayScore : f.awayScore > f.homeScore);
    const badge = isWin && f.decided && f.decided !== "reg" ? `<sup class="${badgeCls}">${f.decided === "pens" ? "p" : "aet"}</sup>` : "";
    const label = S.team
      ? (S.proj ? `<span class="proj">${teamLabel(S.team, noOwner)}</span>` : teamLabel(S.team, noOwner))
      : `<span class="src">${esc(S.src || "TBD")}</span>`;
    return { label, isWin, score, badge };
  }

  const isSmallScreen = () => !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);

  function renderBracket() {
    const P = window.WC_ENGINE.projector(D);
    return isSmallScreen() ? renderBracketList(P) : renderBracketCanvas(P);
  }

  // Mobile: a round-by-round stack of tie cards (no horizontal scroll), each
  // showing its kickoff date + time.
  function renderBracketList(P) {
    const order = ["R32", "R16", "QF", "SF", "3P", "F"];
    const sections = order.map((r) => {
      const fx = D.knockoutFixtures.filter((f) => f.round === r);
      if (!fx.length) return "";
      const ties = fx.map((f) => {
        const H = P.side(f, "home"), A = P.side(f, "away");
        const mine = ME && (ownerOf[H.team] === ME || ownerOf[A.team] === ME);
        const line = (S, which) => {
          const s = bracketSideHtml(f, S, which, "ko-s", "bdg");
          return `<div class="ko-line ${s.isWin ? "win" : ""}">${s.label}<span class="ko-s">${s.score}${s.badge}</span></div>`;
        };
        const when = fmtKick(f);
        return `<div class="ko-tie ${f.played ? "done" : ""} ${mine ? "mine" : ""}"${espnAttr(f)}>
          ${line(H, "home")}${line(A, "away")}
          ${when ? `<div class="ko-when">${esc(when)}</div>` : ""}
        </div>`;
      }).join("");
      return `<section class="ko-round"><h3>${ROUND_TITLE[r]}</h3><div class="ties">${ties}</div></section>`;
    }).join("");
    return `<div class="ko-list">${sections}
      ${ME ? `<p class="brkey"><span class="dot" style="background:${colorFor(ME)}"></span>Your teams are highlighted · italic = projected from latest results</p>` : ""}
    </div>`;
  }

  // Desktop: connected bracket drawn top → bottom, with kickoff captions under
  // each tie and full date + time in the hover title.
  function renderBracketCanvas(P) {
    const byId = {};
    D.knockoutFixtures.forEach((f) => { byId[f.id] = f; });
    const rows = ["R32", "R16", "QF", "SF", "F"];
    const depth = { R32: 0, R16: 1, QF: 2, SF: 3, F: 4 };

    // --- geometry (top → bottom) ---
    const TIE_W = 124, TIE_H = 46, UNIT = 138, ROW_GAP = 46, PAD_L = 60, PAD_T = 6;
    const ROW_H = TIE_H + ROW_GAP;
    const leaf = [];
    (function dfs(id) {
      const f = byId[id]; if (!f) return;
      if (f.round === "R32") { if (!leaf.includes(id)) leaf.push(id); return; }
      dfs(f.feedHome); dfs(f.feedAway);
    })("F-1");
    D.knockoutFixtures.filter((f) => f.round === "R32").forEach((f) => { if (!leaf.includes(f.id)) leaf.push(f.id); });
    const cxm = {};
    leaf.forEach((id, i) => { cxm[id] = PAD_L + i * UNIT + UNIT / 2; });
    const cx = (id) => cxm[id] != null ? cxm[id] : (cxm[id] = (cx(byId[id].feedHome) + cx(byId[id].feedAway)) / 2);
    rows.forEach((r) => D.knockoutFixtures.filter((f) => f.round === r).forEach((f) => cx(f.id)));
    const yTop = (round) => PAD_T + depth[round] * ROW_H;
    const totalW = PAD_L + leaf.length * UNIT + 16;
    const totalH = PAD_T + rows.length * ROW_H;

    let paths = "";
    D.knockoutFixtures.forEach((f) => {
      if (f.round === "R32" || f.round === "3P") return;
      const yc = yTop(f.round), xc = cx(f.id);
      [f.feedHome, f.feedAway].forEach((fid) => {
        const pf = byId[fid]; if (!pf) return;
        const xf = cx(fid), yf = yTop(pf.round) + TIE_H, midY = (yf + yc) / 2;
        paths += `<path d="M ${xf} ${yf} V ${midY} H ${xc} V ${yc}"/>`;
      });
    });

    const box = (f, absolute) => {
      const H = P.side(f, "home"), A = P.side(f, "away");
      const mine = ME && (ownerOf[H.team] === ME || ownerOf[A.team] === ME);
      const sideHtml = (S, which) => {
        const s = bracketSideHtml(f, S, which, "bs", "bdg");
        return `<div class="bxline ${s.isWin ? "win" : ""}">${s.label}<span class="bs">${s.score}${s.badge}</span></div>`;
      };
      const pos = absolute
        ? `style="left:${cx(f.id) - TIE_W / 2}px;top:${yTop(f.round)}px;width:${TIE_W}px;height:${TIE_H}px"`
        : `style="width:${TIE_W}px"`;
      // Hover tooltip data: round + kickoff, then how each side reaches this tie.
      // Composed into a styled panel by wireBracketTips().
      const path = (S, which) => {
        const txt = srcText(which === "home" ? f.srcHome : f.srcAway);
        return S.team ? `${S.team} — ${txt}` : txt;
      };
      const data = `data-tround="${esc(ROUND_TITLE[f.round] || f.round)}" data-twhen="${esc(fmtKick(f) || "")}" data-thome="${esc(path(H, "home"))}" data-taway="${esc(path(A, "away"))}"`;
      return `<div class="bx ${f.played ? "done" : ""} ${mine ? "mine" : ""}" ${pos} ${data}${espnAttr(f)}>${sideHtml(H, "home")}${sideHtml(A, "away")}</div>`;
    };

    const boxes = rows.map((r) => D.knockoutFixtures.filter((f) => f.round === r).map((f) => box(f, true)).join("")).join("");
    const caps = rows.map((r) => D.knockoutFixtures.filter((f) => f.round === r).map((f) => {
      const when = fmtKick(f);
      return when ? `<span class="bxcap" style="left:${cx(f.id) - TIE_W / 2}px;top:${yTop(f.round) + TIE_H + 3}px;width:${TIE_W}px">${esc(when)}</span>` : "";
    }).join("")).join("");
    const labels = rows.map((r) => `<span class="brow" style="top:${yTop(r)}px;height:${TIE_H}px">${ROUND_SHORT[r]}</span>`).join("");
    const tp = byId["3P-1"];

    return `<div class="bracket2-wrap">
      <div class="bracket2" style="width:${totalW}px;height:${totalH}px">
        <svg class="blines" width="${totalW}" height="${totalH}" aria-hidden="true">${paths}</svg>
        ${labels}
        ${boxes}
        ${caps}
      </div>
      ${tp ? `<div class="tp"><h4>${ROUND_TITLE["3P"]}</h4>${box(tp, false)}${fmtKick(tp) ? `<p class="tpwhen">${esc(fmtKick(tp))}</p>` : ""}</div>` : ""}
      ${ME ? `<p class="brkey"><span class="dot" style="background:${colorFor(ME)}"></span>Your teams are highlighted · italic = projected from latest results</p>` : ""}
    </div>`;
  }

  // Order one player's teams per the active Players-tab sort choice.
  function sortPlayerTeams(teams, teamPts) {
    const arr = teams.slice();
    if (playerSort === "alpha") {
      arr.sort((a, b) => a.localeCompare(b));
    } else if (playerSort === "fifa") {
      // Lower FIFA rank = better; unranked teams sink to the bottom.
      arr.sort((a, b) => {
        const ra = teamRank[a], rb = teamRank[b];
        if (ra == null && rb == null) return a.localeCompare(b);
        if (ra == null) return 1;
        if (rb == null) return -1;
        return ra - rb;
      });
    } else {
      arr.sort((a, b) => (teamPts[b] - teamPts[a]) || a.localeCompare(b));
    }
    return arr;
  }

  const PSORT_LABELS = { points: "Points", alpha: "Alphabetical", fifa: "FIFA ranking" };

  function renderPlayers() {
    const stats = playerStats();
    const ranked = PLAYERS.slice().sort((a, b) => {
      const A = stats[a], B = stats[b];
      return (B.pts - A.pts)
        || ((B.gf - B.ga) - (A.gf - A.ga))
        || (B.gf - A.gf)
        || a.localeCompare(b);
    });
    const sortBar = `<div class="psort" role="group" aria-label="Sort each player's teams">
      <span class="psort-label">Sort teams by</span>
      ${PSORTS.map((k) => `<button type="button" class="psort-btn${playerSort === k ? " active" : ""}" data-sort="${k}" aria-pressed="${playerSort === k ? "true" : "false"}">${PSORT_LABELS[k]}</button>`).join("")}
    </div>`;
    return sortBar + `<div class="grid">` + ranked.map((p) => {
      const s = stats[p];
      const teams = sortPlayerTeams(D.players[p], s.teamPts)
        .map((t) => `<li class="${isEliminated(t) ? "out" : ""}">
          <span>${teamLabel(t)} <small class="grp">${teamGroup[t] || ""}</small></span>
          <span class="trk">${teamRank[t] != null ? `<small class="fifarank" title="FIFA world ranking">#${teamRank[t]}</small>` : ""}<b>${s.teamPts[t]} pt${s.teamPts[t] === 1 ? "" : "s"}</b></span>
        </li>`).join("");
      const ranks = D.players[p].map((t) => teamRank[t]).filter((r) => r != null);
      const avgRank = ranks.length ? (ranks.reduce((a, b) => a + b, 0) / ranks.length) : null;
      return `<section class="card player ${p === ME ? "me" : ""}">
        <h3><span class="pchip" style="background:${colorFor(p)}"></span>${esc(p)} <span class="ptotal">${s.pts} pts</span></h3>
        <p class="sub">${s.alive}/${D.players[p].length} teams still alive${avgRank != null ? ` · avg FIFA rank <b>${avgRank.toFixed(1)}</b>` : ""}</p>
        <ul class="teamlist">${teams}</ul>
      </section>`;
    }).join("") + (D.config.unallocated && D.config.unallocated.length
      ? `<section class="card"><h3>Unallocated</h3><p class="sub">Not drawn by any player</p><ul class="teamlist">${
          D.config.unallocated.map((t) => `<li><span>${teamLabel(t)} <small class="grp">${teamGroup[t] || ""}</small></span></li>`).join("")}</ul></section>`
      : "") + `</div>`;
  }

  function WC_GROUPS() {
    const g = {};
    D.teams.forEach((t) => { (g[t.group] = g[t.group] || []).push(t.name); });
    return g;
  }

  function renderRankings() {
    const stats = teamStats();
    const sorted = D.teams.slice().sort((a, b) => {
      const ra = a.rank != null ? a.rank : 9999;
      const rb = b.rank != null ? b.rank : 9999;
      return ra - rb;
    });
    const rows = sorted.map((t) => `<tr class="${ownerOf[t.name] === ME ? "mine" : ""}">
      <td class="rank fifarank">#${t.rank != null ? t.rank : "–"}</td>
      <td class="tname">${teamLabel(t.name)} <small class="grp">${esc(t.group)}</small></td>
      <td class="pts">${stats[t.name].pts}</td>
    </tr>`).join("");
    return `<table class="board league">
      <thead><tr>
        <th title="FIFA world ranking">FIFA</th>
        <th class="tname">Team</th>
        <th title="Sweepstake points">Pts</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="rules">All ${D.teams.length} tournament teams sorted by FIFA world ranking · Badges show the sweepstake owner · eliminated teams are greyed out</p>`;
  }

  // ---- tabs ----
  const views = {
    leaderboard: renderLeaderboard,
    groups: renderGroups,
    bracket: renderBracket,
    league: renderLeague,
    rankings: renderRankings,
    players: renderPlayers,
  };
  const content = document.getElementById("content");
  const tabs = document.querySelectorAll(".tab");
  let current = "leaderboard";

  // Clicking a match row opens that game on ESPN in a new tab. Rows carry the
  // ESPN game id via data-espn (added by espnAttr once live data has matched
  // the fixture); one delegated listener covers every view's re-rendered rows.
  content.addEventListener("click", (e) => {
    const el = e.target.closest("[data-espn]");
    if (!el || !content.contains(el)) return;
    const id = el.getAttribute("data-espn");
    if (id) window.open(`https://www.espn.com/soccer/match/_/gameId/${encodeURIComponent(id)}`, "_blank", "noopener");
  });

  // The eliminated set + ownerOf are computed once at load; recompute on refresh.
  function recompute() {
    eliminated.clear();
    (D.config.eliminatedTeams || []).forEach((t) => eliminated.add(t));
    D.knockoutFixtures.forEach((f) => {
      if (!counts(f)) return;
      const r = matchResult(f, true);
      if (r.loser && r.loser !== "TBD") eliminated.add(r.loser);
    });
  }

  function show(name) {
    current = name;
    content.innerHTML = views[name]();
    if (name === "groups") wireGroupsNav();
    if (name === "players") wirePlayersSort();
    if (name === "bracket" && !isSmallScreen()) wireBracketTips();
    tabs.forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    content.setAttribute("aria-labelledby", "tab-" + name);
    location.hash = name;
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  // Arrow-key navigation across the tablist (WAI-ARIA tabs pattern).
  const tabList = Array.from(tabs);
  tabList.forEach((t, i) => t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? "first" : e.key === "End" ? "last" : 0;
    if (!d) return;
    e.preventDefault();
    const next = d === "first" ? tabList[0] : d === "last" ? tabList[tabList.length - 1] : tabList[(i + d + tabList.length) % tabList.length];
    next.focus();
    show(next.dataset.view);
  }));
  // initial render is deferred to start(), which runs only after a valid login.

  // The knockout view swaps between the connected bracket and a stacked list at
  // the 720px breakpoint — re-render it when a resize crosses that line.
  let bracketSmall = isSmallScreen();
  window.addEventListener("resize", () => {
    if (current !== "bracket") return;
    const small = isSmallScreen();
    if (small !== bracketSmall) { bracketSmall = small; show("bracket"); }
  });

  // ---- live results ----
  const statusEl = document.getElementById("live-status");
  const refreshBtn = document.getElementById("live-refresh");
  function setStatus(text, cls) { if (statusEl) { statusEl.textContent = text; statusEl.className = "live-status " + (cls || ""); } }

  async function refreshLive(manual) {
    if (!window.WC_LIVE || !window.WC_LIVE.enabled(D)) { setStatus("Showing saved results — edit data.js to update", "muted"); if (refreshBtn) refreshBtn.style.display = "none"; return; }
    setStatus("Fetching latest results…", "loading");
    const r = await window.WC_LIVE.fetchAndMerge(D);
    if (r.ok) {
      recompute();
      show(current);
      const t = r.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setStatus(`Live · ${r.finished} results in · updated ${t}`, "ok");
    } else if (r.skipped) {
      setStatus("Manual mode — edit data.js", "muted");
    } else {
      setStatus("Offline — showing saved data" + (manual ? " (retry failed)" : ""), "warn");
    }
  }
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshLive(true));

  // ---- gate / login ----
  // Nothing renders and NO API call happens until a valid player signs in.
  const ME_KEY = "wc_user";
  const PLAYERS_LC = {};
  PLAYERS.forEach((p) => { PLAYERS_LC[p.toLowerCase()] = p; });
  let started = false;

  function start() {
    if (started) return; started = true;
    show(views[location.hash.slice(1)] ? location.hash.slice(1) : "leaderboard");
    refreshLive(false); // <-- the API is called once, when the user signs in
  }

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function unlock(name, instant) {
    ME = name;
    try { localStorage.setItem(ME_KEY, name); } catch (_) {}
    const gate = document.getElementById("gate");
    const site = document.getElementById("site");
    document.body.classList.remove("locked");
    if (instant) {
      if (gate) gate.style.display = "none";
      if (site) site.classList.add("reveal");
      start();
      return;
    }
    if (gate) gate.classList.add("exit"); // clouds part to reveal the app
    start();
    requestAnimationFrame(() => { if (site) site.classList.add("reveal"); });
    // let the clouds open a touch before the confetti bursts through
    if (!reduceMotion) setTimeout(fireConfetti, 180);
    setTimeout(() => { if (gate) gate.style.display = "none"; }, 550);
  }

  const gateForm = document.getElementById("gate-form");
  const gateInput = document.getElementById("gate-input");
  const gateChips = document.getElementById("gate-chips");
  const gateErr = document.getElementById("gate-error");
  const gateCard = document.querySelector(".gate-card");

  function tryName(raw) {
    const n = String(raw || "").trim().toLowerCase();
    if (PLAYERS_LC[n]) { unlock(PLAYERS_LC[n], false); return; }
    if (gateErr) gateErr.textContent = raw && raw.trim() ? `"${raw.trim()}" isn't on the list` : "Enter your name to continue";
    if (gateCard) { gateCard.classList.remove("shake"); void gateCard.offsetWidth; gateCard.classList.add("shake"); }
  }

  if (gateChips) PLAYERS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "gate-chip"; b.textContent = p;
    b.addEventListener("click", () => unlock(p, false));
    gateChips.appendChild(b);
  });
  if (gateForm) gateForm.addEventListener("submit", (e) => { e.preventDefault(); tryName(gateInput && gateInput.value); });

  // already signed in this browser? skip straight in.
  let saved = null; try { saved = localStorage.getItem(ME_KEY); } catch (_) {}
  if (saved && PLAYERS_LC[saved.toLowerCase()]) unlock(PLAYERS_LC[saved.toLowerCase()], true);
  else if (gateInput) gateInput.focus();

  // ---- confetti burst (no dependencies) ----
  function fireConfetti() {
    const c = document.getElementById("confetti");
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = window.innerWidth * dpr; c.height = window.innerHeight * dpr;
    const colors = ["#1a6b4a", "#b8860b", "#2a9d8f", "#e6b422", "#5b6cf0", "#ffffff"];
    const parts = Array.from({ length: 170 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 160,
      y: window.innerHeight * 0.52,
      vx: (Math.random() - 0.5) * 18,
      vy: -Math.random() * 17 - 6,
      g: 0.34 + Math.random() * 0.22,
      s: 4 + Math.random() * 7,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.34,
      color: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const el = t - t0;
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = false;
      const a = Math.max(0, 1 - el / 2600);
      parts.forEach((p) => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
        if (a > 0 && p.y < window.innerHeight + 40) alive = true;
        ctx.save(); ctx.globalAlpha = a;
        ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s * dpr / 2, -p.s * dpr / 2, p.s * dpr, p.s * dpr * 0.6);
        ctx.restore();
      });
      if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    })(t0);
  }
})();
