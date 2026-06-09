/* Automatic results for the World Cup 2026 sweepstake.
   Fetches finished scores from TheSportsDB (CORS-enabled, free) and merges
   them onto window.WC_DATA in place. Falls back silently to the data.js
   seed when offline or if the API is unreachable. See README.md. */
(function () {
  "use strict";

  function cfg(D) { return (D.config && D.config.live) || {}; }

  // ---- name normalisation ----
  function buildCanon(D) {
    const aliases = cfg(D).aliases || {};
    const ours = {};               // normalised -> canonical (our) name
    const norm = (s) => String(s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip accents
      .replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
    D.teams.forEach((t) => { ours[norm(t.name)] = t.name; });
    return function canon(apiName) {
      if (aliases[apiName]) return aliases[apiName];
      const n = norm(apiName);
      return ours[n] || apiName;
    };
  }

  // ---- status helpers ----
  const IN_PROGRESS = /^(ns|not started|tbd|postp|postponed|canc|cancelled|abandoned|1h|2h|ht|et|bt|live|p|susp)$/i;
  function isFinished(ev) {
    const s = String(ev.strStatus || "").trim();
    const hs = ev.intHomeScore, as = ev.intAwayScore;
    const hasScore = hs !== null && hs !== "" && as !== null && as !== "";
    if (/finish|full ?time|^ft$|aet|after|pen/i.test(s)) return hasScore;
    if (!s || IN_PROGRESS.test(s)) return false;
    return hasScore; // unknown but final-looking status with a score
  }
  function decidedFrom(ev) {
    const s = String(ev.strStatus || "");
    if (/pen/i.test(s)) return "pens";
    if (/aet|extra/i.test(s)) return "et";
    return "reg";
  }
  const num = (v) => (v === null || v === "" || v === undefined) ? null : parseInt(v, 10);

  // ---- merge ----
  function merge(D, events) {
    const canon = buildCanon(D);
    const pairKey = (a, b) => [a, b].sort().join(" | ");

    // index group fixtures by unordered team pair
    const groupByPair = {};
    D.groupFixtures.forEach((f) => { groupByPair[pairKey(f.home, f.away)] = f; });

    let updated = 0, finished = 0;
    const koEvents = [];
    const kw = cfg(D).knockoutWindows || {};
    const koStart = (kw.R32 && kw.R32[0]) || "2026-06-28"; // events on/after this are knockouts

    events.forEach((ev) => {
      const home = canon(ev.strHomeTeam), away = canon(ev.strAwayTeam);
      // same-group teams can meet again in the knockouts; never let a knockout
      // date overwrite a group fixture.
      const gf = (ev.dateEvent && ev.dateEvent >= koStart) ? null : groupByPair[pairKey(home, away)];
      if (gf) {
        if (gf.lock) return;
        if (ev.dateEvent) gf.date = ev.dateEvent;        // adopt the real date
        if (isFinished(ev)) {
          const hs = num(ev.intHomeScore), as = num(ev.intAwayScore);
          // align to the fixture's home/away orientation
          gf.homeScore = (home === gf.home) ? hs : as;
          gf.awayScore = (home === gf.home) ? as : hs;
          gf.played = true;
          finished++;
        }
        updated++;
      } else {
        koEvents.push({ ev, home, away }); // knockout (or unknown) — handle below
      }
    });

    finished += mergeKnockouts(D, koEvents);
    return { updated, finished };
  }

  function inWindow(date, win) { return date && date >= win[0] && date <= win[1]; }

  function mergeKnockouts(D, koEvents) {
    const windows = cfg(D).knockoutWindows || {};
    const ourTeams = new Set(D.teams.map((t) => t.name));
    let finished = 0;

    Object.keys(windows).forEach((round) => {
      const slots = D.knockoutFixtures.filter((f) => f.round === round);
      // events whose date falls in this round's window and involve real teams
      const evs = koEvents
        .filter((x) => inWindow(x.ev.dateEvent, windows[round]) &&
                       ourTeams.has(x.home) && ourTeams.has(x.away))
        .sort((a, b) => (a.ev.dateEvent || "").localeCompare(b.ev.dateEvent || "") ||
                        a.home.localeCompare(b.home));
      evs.forEach((x, i) => {
        const f = slots[i];
        if (!f || f.lock) return;
        f.home = x.home; f.away = x.away;
        if (x.ev.dateEvent) f.date = x.ev.dateEvent;
        if (isFinished(x.ev)) {
          const hs = num(x.ev.intHomeScore), as = num(x.ev.intAwayScore);
          f.homeScore = hs; f.awayScore = as;
          f.decided = decidedFrom(x.ev);
          if (f.decided === "pens") f.winner = hs > as ? f.home : as > hs ? f.away : null;
          else f.winner = hs > as ? f.home : as > hs ? f.away : null;
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
      const url = `https://www.thesportsdb.com/api/v1/json/${c.key}/eventsseason.php?id=${c.league}&s=${c.season}`;
      const CACHE_KEY = "wc_live_events", MAX_AGE = (c.cacheSeconds || 60) * 1000;
      try {
        let events = null;
        // Reuse a recent cached response to avoid hammering the shared API key.
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
          if (cached && (Date.now() - cached.t) < MAX_AGE) events = cached.events;
        } catch (_) {}
        if (!events) {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const json = await res.json();
          events = json.events || [];
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), events })); } catch (_) {}
        }
        const r = merge(D, events);
        return { ok: true, events: events.length, ...r, time: new Date() };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  };
})();
