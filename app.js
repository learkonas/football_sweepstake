/* World Cup 2026 Sweepstake tracker — all rendering & scoring logic.
   No build step, no framework. Reads window.WC_DATA from data.js. */
(function () {
  "use strict";

  const D = window.WC_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:2rem'>data.js failed to load.</p>"; return; }

  const PTS = D.config.points;
  const PLAYERS = D.config.playerOrder;
  let ME = null; // the signed-in player
  const PLAYER_COLORS = ["#e63946", "#2a9d8f", "#e9a020", "#5b6cf0", "#9b5de5"];
  const colorFor = (p) => PLAYER_COLORS[PLAYERS.indexOf(p) % PLAYER_COLORS.length];

  // ---- lookups ----
  const teamGroup = {};
  D.teams.forEach((t) => { teamGroup[t.name] = t.group; });

  const ownerOf = {};
  Object.keys(D.players).forEach((p) => D.players[p].forEach((t) => { ownerOf[t] = p; }));

  const allFixtures = D.groupFixtures.concat(D.knockoutFixtures);

  // A team is eliminated if manually flagged OR it lost a played knockout match.
  const eliminated = new Set(D.config.eliminatedTeams || []);
  D.knockoutFixtures.forEach((f) => {
    if (!f.played) return;
    const r = matchResult(f, true);
    if (r.loser && r.loser !== "TBD") eliminated.add(r.loser);
  });
  const isEliminated = (t) => eliminated.has(t);

  // ---- scoring ----
  // Returns { winner, loser, draw, homePts, awayPts } for a played fixture.
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
      stats[p] = { pts: 0, win: 0, penWin: 0, draw: 0, loss: 0, penLoss: 0, alive: 0, teamPts: {} };
      D.players[p].forEach((t) => { stats[p].teamPts[t] = 0; if (!isEliminated(t)) stats[p].alive++; });
    });

    function award(team, pts, kind) {
      const p = ownerOf[team];
      if (!p) return;
      stats[p].pts += pts;
      stats[p].teamPts[team] += pts;
      stats[p][kind]++;
    }

    D.groupFixtures.forEach((f) => {
      if (!f.played) return;
      const r = matchResult(f, false);
      award(f.home, r.homePts, r.kind[0]);
      award(f.away, r.awayPts, r.kind[1]);
    });
    D.knockoutFixtures.forEach((f) => {
      if (!f.played || f.home === "TBD" || f.away === "TBD") return;
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

  function ownerTag(team) {
    const p = ownerOf[team];
    if (!p) return "";
    return `<span class="owner" style="background:${colorFor(p)}" title="${esc(p)}">${esc(p[0])}</span>`;
  }
  function teamLabel(team) {
    if (!team || team === "TBD") return `<span class="team tbd">${esc(team || "TBD")}</span>`;
    const cls = isEliminated(team) ? "team out" : "team";
    return `<span class="${cls}">${ownerTag(team)}${esc(team)}</span>`;
  }

  // ---- renderers ----
  const MEDALS = ["🥇", "🥈", "🥉"];
  function renderLeaderboard() {
    const stats = playerStats();
    const ranked = PLAYERS.slice().sort((a, b) =>
      stats[b].pts - stats[a].pts || stats[b].win - stats[a].win || stats[b].alive - stats[a].alive);
    const rows = ranked.map((p, i) => {
      const s = stats[p];
      const rank = MEDALS[i] ? `<span class="medal">${MEDALS[i]}</span>` : i + 1;
      return `<tr class="${p === ME ? "me" : ""} ${i === 0 ? "leader" : ""}">
        <td class="rank">${rank}</td>
        <td><span class="pchip" style="background:${colorFor(p)}"></span>${esc(p)}</td>
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

  // Compact match row for the leaderboard's match centre. Resolves knockout
  // teams via the projector; group teams are already known.
  function mcRow(f, P) {
    const ko = f.round != null;
    const H = ko ? P.side(f, "home") : { team: f.home, proj: false };
    const A = ko ? P.side(f, "away") : { team: f.away, proj: false };
    const mine = ME && (ownerOf[H.team] === ME || ownerOf[A.team] === ME);
    const sh = bracketSideHtml(f, H, "home", "", "bdg");
    const sa = bracketSideHtml(f, A, "away", "", "bdg");
    const sc = f.played ? `${f.homeScore}&ndash;${f.awayScore}` : "v";
    const tag = ko ? (ROUND_TAG[f.round] || f.round) : `Grp ${f.group}`;
    const today = f.date === todayStr() ? " today" : "";
    return `<div class="mc-row ${f.played ? "done" : ""} ${mine ? "mine" : ""}${today}">
      <span class="mc-when">${esc(fmtKick(f))}</span>
      <span class="mc-tag">${esc(tag)}</span>
      <span class="mc-match">
        <span class="mc-side ${sh.isWin ? "win" : ""}">${sh.label}</span>
        <span class="mc-sc">${sc}${sh.badge || sa.badge}</span>
        <span class="mc-side ${sa.isWin ? "win" : ""}">${sa.label}</span>
      </span>
    </div>`;
  }

  function renderMatchCentre() {
    const P = window.WC_ENGINE.projector(D);
    const all = D.groupFixtures.concat(D.knockoutFixtures);
    const played = all.filter((f) => f.played).sort((a, b) => whenOf(b) - whenOf(a));
    const upcoming = all.filter((f) => !f.played && f.date).sort((a, b) => whenOf(a) - whenOf(b));
    const results = played.slice(0, 6).map((f) => mcRow(f, P)).join("") || `<p class="mc-empty">No results in yet — kicks off ${esc(fmtDate(D.groupFixtures[0] && D.groupFixtures[0].date))}.</p>`;
    const next = upcoming.slice(0, 6).map((f) => mcRow(f, P)).join("") || `<p class="mc-empty">Tournament complete 🏆</p>`;
    return `<div class="matchcentre">
      <section class="mc-col"><h3>Latest results</h3>${results}</section>
      <section class="mc-col"><h3>Coming up</h3>${next}</section>
    </div>`;
  }

  function renderGroups() {
    return `<div class="grid">` + Object.keys(WC_GROUPS()).map((g) => {
      const standings = groupStandings(g);
      const srows = standings.map((r, i) => `<tr class="${i < 2 ? "qual" : i === 2 ? "third" : ""}">
        <td class="tname">${teamLabel(r.team)}</td>
        <td>${r.P}</td><td>${r.W}</td><td>${r.Dr}</td><td>${r.L}</td>
        <td>${r.GF}</td><td>${r.GA}</td><td>${r.GD > 0 ? "+" + r.GD : r.GD}</td><td class="pts">${r.Pts}</td>
      </tr>`).join("");
      const fixtures = D.groupFixtures.filter((f) => f.group === g)
        .sort((a, b) => a.matchday - b.matchday || a.date.localeCompare(b.date))
        .map((f) => fixtureRow(f, false)).join("");
      return `<section class="card">
        <h3>Group ${g}</h3>
        <table class="standings">
          <thead><tr><th class="tname">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${srows}</tbody>
        </table>
        <div class="fixtures">${fixtures}</div>
      </section>`;
    }).join("") + `</div>`;
  }

  function fixtureRow(f, knockout) {
    const played = f.played;
    const score = played ? `${f.homeScore}&ndash;${f.awayScore}` : "v";
    let badge = "";
    if (knockout && played && f.decided) {
      const label = f.decided === "pens" ? "pens" : f.decided === "et" ? "AET" : "";
      if (label) badge = `<span class="decided">${label}</span>`;
    }
    return `<div class="fx ${played ? "done" : ""}">
      <span class="date">${fmtDate(f.date)}${f.kickoff ? `<small>${fmtTime(f.kickoff)}</small>` : ""}</span>
      <span class="side home">${teamLabel(f.home)}</span>
      <span class="score">${score}${badge}</span>
      <span class="side away">${teamLabel(f.away)}</span>
    </div>`;
  }

  const ROUND_TITLE = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals", SF: "Semi-finals", "3P": "Third place", F: "Final" };
  const ROUND_SHORT = { R32: "R32", R16: "R16", QF: "QF", SF: "SF", F: "Final" };
  const ROUND_TAG = { R32: "R32", R16: "R16", QF: "QF", SF: "SF", "3P": "3rd place", F: "Final" };

  // Today (local) as YYYY-MM-DD, and a sortable kickoff time for any fixture.
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const whenOf = (f) => new Date(f.kickoff || ((f.date || "9999-12-31") + "T12:00:00")).getTime();

  // One side of a tie, as HTML: team (italic if projected) or its source label,
  // plus the score and an aet/pens badge on the winner. Shared by both layouts.
  function bracketSideHtml(f, S, which, scoreCls, badgeCls) {
    const score = f.played ? (which === "home" ? f.homeScore : f.awayScore) : "";
    const isWin = f.played && S.team && (f.winner ? f.winner === S.team
      : which === "home" ? f.homeScore > f.awayScore : f.awayScore > f.homeScore);
    const badge = isWin && f.decided && f.decided !== "reg" ? `<sup class="${badgeCls}">${f.decided === "pens" ? "p" : "aet"}</sup>` : "";
    const label = S.team
      ? (S.proj ? `<span class="proj">${teamLabel(S.team)}</span>` : teamLabel(S.team))
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
        return `<div class="ko-tie ${f.played ? "done" : ""} ${mine ? "mine" : ""}">
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
      const title = `${H.team || H.src} vs ${A.team || A.src}${fmtKick(f) ? " — " + fmtKick(f) : ""}`;
      return `<div class="bx ${f.played ? "done" : ""} ${mine ? "mine" : ""}" ${pos} title="${esc(title)}">${sideHtml(H, "home")}${sideHtml(A, "away")}</div>`;
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

  function renderPlayers() {
    const stats = playerStats();
    return `<div class="grid">` + PLAYERS.map((p) => {
      const s = stats[p];
      const teams = D.players[p].slice().sort((a, b) => s.teamPts[b] - s.teamPts[a])
        .map((t) => `<li class="${isEliminated(t) ? "out" : ""}">
          <span>${teamLabel(t)} <small class="grp">${teamGroup[t] || ""}</small></span>
          <b>${s.teamPts[t]} pt${s.teamPts[t] === 1 ? "" : "s"}</b>
        </li>`).join("");
      return `<section class="card player ${p === ME ? "me" : ""}">
        <h3><span class="pchip" style="background:${colorFor(p)}"></span>${esc(p)} <span class="ptotal">${s.pts} pts</span></h3>
        <p class="sub">${s.alive}/${D.players[p].length} teams still alive</p>
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

  // ---- tabs ----
  const views = {
    leaderboard: renderLeaderboard,
    groups: renderGroups,
    bracket: renderBracket,
    players: renderPlayers,
  };
  const content = document.getElementById("content");
  const tabs = document.querySelectorAll(".tab");
  let current = "leaderboard";

  // The eliminated set + ownerOf are computed once at load; recompute on refresh.
  function recompute() {
    eliminated.clear();
    (D.config.eliminatedTeams || []).forEach((t) => eliminated.add(t));
    D.knockoutFixtures.forEach((f) => {
      if (!f.played) return;
      const r = matchResult(f, true);
      if (r.loser && r.loser !== "TBD") eliminated.add(r.loser);
    });
  }

  function show(name) {
    current = name;
    content.innerHTML = views[name]();
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
    const who = document.getElementById("whoami");
    if (who && ME) {
      who.innerHTML = `<span class="pchip" style="background:${colorFor(ME)}"></span>Signed in as <b>${esc(ME)}</b> <span class="switch">switch</span>`;
      who.classList.add("show");
      who.addEventListener("click", () => { try { localStorage.removeItem(ME_KEY); } catch (_) {} location.reload(); });
    }
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
    if (!reduceMotion) setTimeout(fireConfetti, 450);
    setTimeout(() => { if (gate) gate.style.display = "none"; }, 2100);
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
