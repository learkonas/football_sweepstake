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
        const loser = winner === f.home ? f.away : f.home;
        return {
          winner, loser, draw: false,
          homePts: winner === f.home ? PTS.penWin : PTS.draw,
          awayPts: winner === f.away ? PTS.penWin : PTS.draw,
          kind: winner === f.home ? ["penWin", "penLoss"] : ["penLoss", "penWin"],
        };
      }
      // decided in regulation or extra time: win = 3, loss = 0
      const winner = hs > as ? f.home : as > hs ? f.away : (f.winner || null);
      const loser = winner === f.home ? f.away : f.home;
      return {
        winner, loser, draw: false,
        homePts: winner === f.home ? PTS.win : PTS.loss,
        awayPts: winner === f.away ? PTS.win : PTS.loss,
        kind: winner === f.home ? ["win", "loss"] : ["loss", "win"],
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

  // ---- group standings ----
  function groupStandings(g) {
    const rows = {};
    D.teams.filter((t) => t.group === g).forEach((t) => {
      rows[t.name] = { team: t.name, P: 0, W: 0, Dr: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
    });
    D.groupFixtures.filter((f) => f.group === g && f.played).forEach((f) => {
      const h = rows[f.home], a = rows[f.away];
      h.P++; a.P++;
      h.GF += f.homeScore; h.GA += f.awayScore;
      a.GF += f.awayScore; a.GA += f.homeScore;
      if (f.homeScore > f.awayScore) { h.W++; a.L++; h.Pts += 3; }
      else if (f.awayScore > f.homeScore) { a.W++; h.L++; a.Pts += 3; }
      else { h.Dr++; a.Dr++; h.Pts++; a.Pts++; }
    });
    return Object.values(rows).map((r) => { r.GD = r.GF - r.GA; return r; })
      .sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.team.localeCompare(y.team));
  }

  // ---- formatting ----
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s + "T00:00:00");
    return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
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
  function renderLeaderboard() {
    const stats = playerStats();
    const ranked = PLAYERS.slice().sort((a, b) =>
      stats[b].pts - stats[a].pts || stats[b].win - stats[a].win || stats[b].alive - stats[a].alive);
    const rows = ranked.map((p, i) => {
      const s = stats[p];
      return `<tr class="${p === ME ? "me" : ""}">
        <td class="rank">${i + 1}</td>
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
      <p class="rules">Scoring: <b>${PTS.win}</b> win &middot; <b>${PTS.penWin}</b> shootout win &middot; <b>${PTS.draw}</b> draw after 90 &middot; <b>${PTS.loss}</b> loss in 90.</p>`;
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
      <span class="date">${fmtDate(f.date)}</span>
      <span class="side home">${teamLabel(f.home)}</span>
      <span class="score">${score}${badge}</span>
      <span class="side away">${teamLabel(f.away)}</span>
    </div>`;
  }

  const ROUND_TITLE = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals", SF: "Semi-finals", "3P": "Third place", F: "Final" };

  function renderBracket() {
    const byId = {};
    D.knockoutFixtures.forEach((f) => { byId[f.id] = f; });
    const cols = ["R32", "R16", "QF", "SF", "F"];
    const colIndex = { R32: 0, R16: 1, QF: 2, SF: 3, F: 4 };

    const TIE_W = 160, TIE_H = 46, UNIT = 62, COL_GAP = 48, PAD_T = 8;
    const COL_W = TIE_W + COL_GAP;

    // vertical leaf order = depth-first walk of the tree from the final
    const leafOrder = [];
    (function dfs(id) {
      const f = byId[id];
      if (!f) return;
      if (f.round === "R32") { if (!leafOrder.includes(id)) leafOrder.push(id); return; }
      dfs(f.feedHome); dfs(f.feedAway);
    })("F-1");
    D.knockoutFixtures.filter((f) => f.round === "R32").forEach((f) => { if (!leafOrder.includes(f.id)) leafOrder.push(f.id); });

    const centerY = {};
    leafOrder.forEach((id, i) => { centerY[id] = PAD_T + i * UNIT + UNIT / 2; });
    function cy(id) {
      if (centerY[id] != null) return centerY[id];
      const f = byId[id];
      centerY[id] = (cy(f.feedHome) + cy(f.feedAway)) / 2;
      return centerY[id];
    }
    cols.forEach((r) => D.knockoutFixtures.filter((f) => f.round === r).forEach((f) => cy(f.id)));

    const totalH = PAD_T * 2 + leafOrder.length * UNIT;
    const totalW = cols.length * COL_W;

    // connector lines
    let paths = "";
    D.knockoutFixtures.forEach((f) => {
      if (f.round === "R32" || f.round === "3P") return;
      const xc = colIndex[f.round] * COL_W;
      [f.feedHome, f.feedAway].forEach((fid) => {
        const pf = byId[fid]; if (!pf) return;
        const xf = colIndex[pf.round] * COL_W + TIE_W;
        const midX = (xf + xc) / 2;
        paths += `<path d="M ${xf} ${cy(fid)} H ${midX} V ${cy(f.id)} H ${xc}"/>`;
      });
    });

    const box = (f, absolute) => {
      const mine = ME && (ownerOf[f.home] === ME || ownerOf[f.away] === ME);
      const side = (which) => {
        const team = which === "home" ? f.home : f.away;
        const src = which === "home" ? f.srcHome : f.srcAway;
        const score = f.played ? (which === "home" ? f.homeScore : f.awayScore) : "";
        const isWin = f.played && (f.winner ? f.winner === team
          : which === "home" ? f.homeScore > f.awayScore : f.awayScore > f.homeScore);
        const badge = isWin && f.decided && f.decided !== "reg"
          ? `<sup class="bdg">${f.decided === "pens" ? "p" : "aet"}</sup>` : "";
        const label = (team && team !== "TBD") ? teamLabel(team) : `<span class="src">${esc(src || "TBD")}</span>`;
        return `<div class="bxline ${isWin ? "win" : ""}">${label}<span class="bs">${score}${badge}</span></div>`;
      };
      const pos = absolute ? `style="left:${colIndex[f.round] * COL_W}px;top:${cy(f.id) - TIE_H / 2}px;width:${TIE_W}px;height:${TIE_H}px"` : `style="width:${TIE_W}px"`;
      const title = `${f.home === "TBD" ? f.srcHome : f.home} vs ${f.away === "TBD" ? f.srcAway : f.away}${f.date ? " — " + fmtDate(f.date) : ""}`;
      return `<div class="bx ${f.played ? "done" : ""} ${mine ? "mine" : ""}" ${pos} title="${esc(title)}">${side("home")}${side("away")}</div>`;
    };

    const boxes = cols.map((r) => D.knockoutFixtures.filter((f) => f.round === r).map((f) => box(f, true)).join("")).join("");
    const headers = cols.map((r) => `<span class="bh" style="width:${COL_W}px">${ROUND_TITLE[r]}</span>`).join("");
    const tp = byId["3P-1"];

    return `<div class="bracket2-wrap">
      <div class="bhead" style="width:${totalW}px">${headers}</div>
      <div class="bracket2" style="width:${totalW}px;height:${totalH}px">
        <svg class="blines" width="${totalW}" height="${totalH}" aria-hidden="true">${paths}</svg>
        ${boxes}
      </div>
      ${tp ? `<div class="tp"><h4>${ROUND_TITLE["3P"]}</h4>${box(tp, false)}</div>` : ""}
      ${ME ? `<p class="brkey"><span class="dot" style="background:${colorFor(ME)}"></span>Ties with your teams are highlighted</p>` : ""}
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
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    location.hash = name;
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  // initial render is deferred to start(), which runs only after a valid login.

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
    if (!reduceMotion) fireConfetti();
    if (gate) gate.classList.add("exit");
    start();
    requestAnimationFrame(() => { if (site) site.classList.add("reveal"); });
    setTimeout(() => { if (gate) gate.style.display = "none"; }, 1000);
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
    const colors = ["#19c37d", "#e9a020", "#406cf0", "#9b5de5", "#ff6b6b", "#ffffff"];
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
