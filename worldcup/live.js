/* Automatic results for the World Cup 2026 sweepstake.
   Source: ESPN's public soccer API (no key, CORS-enabled). One call returns
   all 104 matches incl. scores, the per-team winner flag and penalty-shootout
   tallies, so knockout winners (incl. shootouts) are detected automatically.
   Merges onto window.WC_DATA in place; falls back silently to the data.js seed
   when offline. See README.md. */
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
      return {
        id: String(e.id || ""),
        date: String(c.date || e.date || "").slice(0, 10),
        home: (h.team && h.team.displayName) || "",
        away: (a.team && a.team.displayName) || "",
        homeScore: toNum(h.score),
        awayScore: toNum(a.score),
        homeWin: h.winner === true,
        awayWin: a.winner === true,
        shootout: toNum(h.shootoutScore) !== null || toNum(a.shootoutScore) !== null,
        finished: ty.completed === true || ty.state === "post",
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
    const pairKey = (a, b) => [a, b].sort().join(" | ");
    const groupByPair = {};
    D.groupFixtures.forEach((f) => { groupByPair[pairKey(f.home, f.away)] = f; });

    const koRounds = cfg(D).koEventRounds || {};
    let updated = 0, finished = 0;
    const koByRound = {};

    events.forEach((ev) => {
      if (!ev.home || !ev.away) return;
      const round = koRounds[ev.id];
      if (round) {                       // knockout event (classified by stable id)
        (koByRound[round] = koByRound[round] || []).push(ev);
        return;
      }
      // group event — match by team pair
      const home = canon(ev.home), away = canon(ev.away);
      const gf = groupByPair[pairKey(home, away)];
      if (!gf || gf.lock) return;
      if (ev.date) gf.date = ev.date;
      if (ev.finished) {
        gf.homeScore = (home === gf.home) ? ev.homeScore : ev.awayScore;
        gf.awayScore = (home === gf.home) ? ev.awayScore : ev.homeScore;
        gf.played = true;
        finished++;
      }
      updated++;
    });

    finished += mergeKnockouts(D, koByRound, canon);
    return { updated, finished };
  }

  function mergeKnockouts(D, koByRound, canon) {
    const ourTeams = new Set(D.teams.map((t) => t.name));
    let finished = 0;
    Object.keys(koByRound).forEach((round) => {
      const slots = D.knockoutFixtures.filter((f) => f.round === round);
      // stable order so a given ESPN tie always maps to the same bracket slot
      const evs = koByRound[round].slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
      evs.forEach((ev, i) => {
        const f = slots[i];
        if (!f || f.lock) return;
        const home = canon(ev.home), away = canon(ev.away);
        const resolved = ourTeams.has(home) && ourTeams.has(away);
        if (ev.date) f.date = ev.date;
        if (resolved) { f.home = home; f.away = away; }
        if (ev.finished && resolved) {
          f.homeScore = ev.homeScore; f.awayScore = ev.awayScore;
          f.decided = decidedOf(ev);
          f.winner = ev.homeWin ? home : ev.awayWin ? away
                    : (ev.homeScore > ev.awayScore ? home : ev.awayScore > ev.homeScore ? away : null);
          f.played = true;
          finished++;
        }
      });
    });
    return finished;
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
