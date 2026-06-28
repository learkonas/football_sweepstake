/* Automatic results for the World Cup 2026 sweepstake.
   Source: ESPN's public soccer API (no key, CORS-enabled). One call returns
   all 104 matches incl. scores, kickoff times, the per-team winner flag and
   penalty-shootout tallies, so knockout winners (incl. shootouts) are detected
   automatically.

   Matching is by team identity, not fixture ids. Group games match on the team
   pair. Knockout games are matched by projecting each bracket slot to the teams
   it should contain (from group standings + feeder winners, via WC_ENGINE) and
   pairing that with the ESPN game between those same two teams — so results land
   in the right slot without any hand-maintained event-id table. Merges onto
   window.WC_DATA in place; falls back silently to the data.js seed when offline.
   See README.md. */
(function () {
  "use strict";

  function cfg(D) { return (D.config && D.config.live) || {}; }
  const toNum = (v) => (v === null || v === "" || v === undefined) ? null : parseInt(v, 10);

  // ---- name normalisation ----
  function buildCanon(D) {
    const aliases = cfg(D).aliases || {};
    const ours = {};
    const norm = (s) => String(s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")   // strip accents
      .replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
    D.teams.forEach((t) => { ours[norm(t.name)] = t.name; });
    return function canon(name) {
      if (aliases[name]) return aliases[name];
      return ours[norm(name)] || name;
    };
  }

  // ---- parse ESPN scoreboard into a flat, source-agnostic shape ----
  function parseEvents(json) {
    return (json.events || []).map((e) => {
      const c = (e.competitions && e.competitions[0]) || {};
      const cs = c.competitors || [];
      const h = cs.find((x) => x.homeAway === "home") || cs[0] || {};
      const a = cs.find((x) => x.homeAway === "away") || cs[1] || {};
      const ty = (c.status && c.status.type) || {};
      const iso = String(c.date || e.date || "");
      return {
        id: String(e.id || ""),
        iso,                          // full kickoff timestamp (ISO, usually UTC)
        date: iso.slice(0, 10),       // YYYY-MM-DD, used for matching
        home: (h.team && h.team.displayName) || "",
        away: (a.team && a.team.displayName) || "",
        homeScore: toNum(h.score),
        awayScore: toNum(a.score),
        homeWin: h.winner === true,
        awayWin: a.winner === true,
        shootout: toNum(h.shootoutScore) !== null || toNum(a.shootoutScore) !== null,
        finished: ty.completed === true || ty.state === "post",
        inProgress: ty.state === "in",          // ESPN: pre | in | post
        detail: String(ty.shortDetail || ty.detail || ""),  // e.g. "45'", "HT"
        statusName: (ty.name || "") + " " + (ty.detail || ""),
        period: (c.status && c.status.period) || 0,
      };
    });
  }

  function decidedOf(ev) {
    if (ev.shootout || /pen/i.test(ev.statusName)) return "pens";
    if (/aet|extra/i.test(ev.statusName) || ev.period > 2) return "et";
    return "reg";
  }

  // ---- merge ----
  function merge(D, events) {
    const canon = buildCanon(D);
    const setKey = (a, b) => [a, b].sort().join(" | ");
    // Earliest knockout date — the boundary between the group and knockout
    // windows. Derived from the data so there's nothing to hand-maintain.
    const koStart = D.knockoutFixtures.reduce((m, f) => (f.date && f.date < m) ? f.date : m, "9999-99-99");
    // ...but split on a timestamp, not a bare date. On the final group day the
    // late kickoffs (22:00 ET) roll past midnight UTC onto the first knockout
    // date, so a date-only test misfiles them as knockout events and drops them
    // from the group merge — leaving those ties with no kickoff time. No group
    // game starts as late as midday UTC the day after the last group day, and no
    // knockout starts before it, so noon UTC on the first knockout date cleanly
    // separates the two windows.
    const koBoundaryMs = new Date(koStart + "T12:00:00Z").getTime();
    const tsOf = (ev) => {
      const ms = ev.iso ? new Date(ev.iso).getTime() : NaN;
      return Number.isNaN(ms) ? (ev.date ? new Date(ev.date + "T00:00:00Z").getTime() : 0) : ms;
    };
    const inGroupWindow = (ev) => tsOf(ev) < koBoundaryMs;
    const consumed = new Set();
    let updated = 0, finished = 0, live = 0;

    function applyResult(f, ev) {
      const home = canon(ev.home);
      f.homeScore = (home === f.home) ? ev.homeScore : ev.awayScore;
      f.awayScore = (home === f.home) ? ev.awayScore : ev.homeScore;
    }

    // --- knockout: project each slot to its teams, match the ESPN game between
    //     them. Round by round so later rounds see winners just applied. ---
    const koBySet = {};
    events.forEach((ev) => {
      if (!ev.home || !ev.away || inGroupWindow(ev)) return; // group-window event
      const k = setKey(canon(ev.home), canon(ev.away));
      // A pair meets at most once in a knockout, but keep the latest just in case.
      if (!koBySet[k] || ev.date > koBySet[k].date) koBySet[k] = ev;
    });
    const proj = window.WC_ENGINE.projector(D);
    ["R32", "R16", "QF", "SF", "3P", "F"].forEach((round) => {
      D.knockoutFixtures.filter((f) => f.round === round).forEach((f) => {
        const t = proj.teams(f);
        if (!t.home || !t.away) return;
        const ev = koBySet[setKey(t.home, t.away)];
        if (!ev || consumed.has(ev.id)) return;
        consumed.add(ev.id);
        f.espnId = ev.id;   // remember the ESPN game so the row can link out
        if (f.lock) return;
        if (ev.iso) { f.date = ev.date; f.kickoff = ev.iso; }
        f.home = t.home; f.away = t.away;   // lock the resolved teams into the slot
        if (ev.finished) {
          applyResult(f, ev);
          f.decided = decidedOf(ev);
          const home = canon(ev.home), away = canon(ev.away);
          f.winner = ev.homeWin ? home : ev.awayWin ? away
            : (f.homeScore > f.awayScore ? f.home : f.awayScore > f.homeScore ? f.away : null);
          f.played = true;
          f.live = false;
          finished++;
        } else if (ev.inProgress) {
          // Match underway: show the running score without counting it yet.
          applyResult(f, ev);
          f.live = true;
          f.liveDetail = ev.detail;
          live++;
        } else {
          f.live = false;
        }
        updated++;
      });
    });

    // --- group: match by team pair within the group window ---
    const groupByPair = {};
    D.groupFixtures.forEach((f) => { groupByPair[setKey(f.home, f.away)] = f; });
    events.forEach((ev) => {
      if (consumed.has(ev.id) || !ev.home || !ev.away) return;
      if (!inGroupWindow(ev)) return; // not a group-window event
      const gf = groupByPair[setKey(canon(ev.home), canon(ev.away))];
      if (!gf) return;
      gf.espnId = ev.id;   // remember the ESPN game so the row can link out
      if (gf.lock) return;
      if (ev.iso) { gf.date = ev.date; gf.kickoff = ev.iso; }
      if (ev.finished) {
        applyResult(gf, ev);
        gf.played = true;
        gf.live = false;
        finished++;
      } else if (ev.inProgress) {
        // Match underway: show the running score without counting it yet.
        applyResult(gf, ev);
        gf.live = true;
        gf.liveDetail = ev.detail;
        live++;
      } else {
        gf.live = false;
      }
      updated++;
    });

    return { updated, finished, live };
  }

  // ---- public API ----
  window.WC_LIVE = {
    enabled: function (D) { return !!cfg(D).enabled; },
    async fetchAndMerge(D) {
      const c = cfg(D);
      if (!c.enabled) return { ok: false, skipped: true };
      try {
        const res = await fetch(c.url, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const events = parseEvents(await res.json());
        const r = merge(D, events);
        return { ok: true, events: events.length, ...r, time: new Date() };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  };
})();
