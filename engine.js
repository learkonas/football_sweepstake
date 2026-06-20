/* Shared tournament engine for the World Cup 2026 sweepstake.
   Pure logic, no DOM: group standings (with FIFA tiebreakers) and the bracket
   projector that resolves each knockout slot to a team from the latest results.
   Used by both app.js (rendering) and live.js (matching ESPN games to slots). */
(function () {
  "use strict";

  // FIFA 2026 tiebreaker order within a cluster of teams equal on points:
  // 1. H2H points, 2. H2H GD, 3. H2H GF, 4. overall GD, 5. overall GF,
  // 6. alphabetical (proxy for disciplinary/lots which aren't in the data).
  // The cluster is sorted in-place. Returns true if any order changed.
  function sortHeadToHead(cluster, fixtures) {
    const names = new Set(cluster.map((r) => r.team));
    const mini = {};
    cluster.forEach((r) => { mini[r.team] = { pts: 0, gd: 0, gf: 0 }; });
    fixtures.forEach((f) => {
      if (!names.has(f.home) || !names.has(f.away)) return;
      const H = mini[f.home], A = mini[f.away];
      H.gf += f.homeScore; H.gd += f.homeScore - f.awayScore;
      A.gf += f.awayScore; A.gd += f.awayScore - f.homeScore;
      if (f.homeScore > f.awayScore) H.pts += 3;
      else if (f.awayScore > f.homeScore) A.pts += 3;
      else { H.pts++; A.pts++; }
    });
    cluster.sort((x, y) => {
      const mx = mini[x.team], my = mini[y.team];
      return my.pts - mx.pts || my.gd - mx.gd || my.gf - mx.gf ||
        y.GD - x.GD || y.GF - x.GF || x.team.localeCompare(y.team);
    });
  }

  function groupStandings(D, g) {
    const rows = {};
    D.teams.filter((t) => t.group === g).forEach((t) => {
      rows[t.name] = { team: t.name, P: 0, W: 0, Dr: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
    });
    // Confirmed results plus any match currently in play (provisional): a live
    // scoreline moves the table straight away, mirroring the leaderboard. Guard
    // against a not-yet-posted live score so NaN can't scramble the sort.
    const fixtures = D.groupFixtures.filter((f) => f.group === g &&
      (f.played || (f.live && typeof f.homeScore === "number" && typeof f.awayScore === "number")));
    fixtures.forEach((f) => {
      const h = rows[f.home], a = rows[f.away];
      h.P++; a.P++;
      h.GF += f.homeScore; h.GA += f.awayScore;
      a.GF += f.awayScore; a.GA += f.homeScore;
      if (f.homeScore > f.awayScore) { h.W++; a.L++; h.Pts += 3; }
      else if (f.awayScore > f.homeScore) { a.W++; h.L++; a.Pts += 3; }
      else { h.Dr++; a.Dr++; h.Pts++; a.Pts++; }
    });
    // Primary sort: points only. H2H is the first tiebreaker (FIFA 2026 rules),
    // so overall GD/GF must not be applied before H2H within equal-points clusters.
    const arr = Object.values(rows).map((r) => { r.GD = r.GF - r.GA; return r; })
      .sort((x, y) => y.Pts - x.Pts);
    // Within each equal-points cluster apply H2H (which falls through to overall
    // GD/GF/alphabetical for any remaining ties inside that cluster).
    const out = [];
    for (let i = 0; i < arr.length;) {
      let j = i + 1;
      while (j < arr.length && arr[j].Pts === arr[i].Pts) j++;
      const cluster = arr.slice(i, j);
      if (cluster.length > 1) sortHeadToHead(cluster, fixtures);
      cluster.forEach((r) => out.push(r));
      i = j;
    }
    return out;
  }

  // Build a bracket projector bound to the current data. Group standings and the
  // third-placed allocation are computed once; feeder winners are read live from
  // the fixtures each call, so projecting later rounds reflects results applied
  // during the same merge pass.
  function projector(D) {
    const byId = {};
    D.knockoutFixtures.forEach((f) => { byId[f.id] = f; });
    const standCache = {};
    const stand = (g) => standCache[g] || (standCache[g] = groupStandings(D, g));
    const groups12 = "ABCDEFGHIJKL".split("");
    const groupDone = {};
    groups12.forEach((g) => { groupDone[g] = D.groupFixtures.filter((f) => f.group === g).every((f) => f.played); });
    // Has a group kicked off yet? Until it has at least one result (confirmed or
    // a live in-play scoreline) its standings are just alphabetical, so there's
    // nothing meaningful to project.
    const groupStarted = {};
    groups12.forEach((g) => { groupStarted[g] = D.groupFixtures.some((f) => f.group === g && (f.played || f.live)); });

    // best-8 third-placed teams -> which group's 3rd each winner faces (FIFA
    // Annex C). Projected from the latest standings once every group is under
    // way (it needs all 12 thirds to pick the best 8 and key the table), so the
    // 3rd-placed R32 slots fill in as projected rather than waiting for the
    // group stage to finish.
    let winnerToThird = null;
    if (groups12.every((g) => groupStarted[g]) && window.WC_THIRDS) {
      const ranked = groups12.map((g) => ({ g, r: stand(g)[2] }))
        .sort((a, b) => b.r.Pts - a.r.Pts || b.r.GD - a.r.GD || b.r.GF - a.r.GF || a.g.localeCompare(b.g));
      const alloc = window.WC_THIRDS.table[ranked.slice(0, 8).map((x) => x.g).sort().join("")];
      if (alloc) { winnerToThird = {}; window.WC_THIRDS.order.split("").forEach((w, i) => { winnerToThird[w] = alloc[i]; }); }
    }

    // Winner of a feeder tie — confirmed or, for a match still in play, the side
    // currently ahead (provisional, propagated down the bracket like a projection).
    const winnerOf = (f) => { if (!f || !(f.played || f.live)) return null; if (f.winner) return f.winner; return f.homeScore > f.awayScore ? f.home : f.awayScore > f.homeScore ? f.away : null; };
    const loserOf = (f) => { const w = winnerOf(f); return w ? (w === f.home ? f.away : f.home) : null; };

    // Resolve one side of a tie: the real team if known, otherwise a projection
    // from group standings / feeder winners. Returns { team, proj, src }.
    // R32 group slots project from the latest standings as soon as a group is
    // under way (not only once it's mathematically settled), so the current top
    // teams show as projected as results come in.
    function side(f, which) {
      const actual = which === "home" ? f.home : f.away;
      if (actual && actual !== "TBD") return { team: actual, proj: false };
      const src = which === "home" ? f.srcHome : f.srcAway;
      if (f.round === "R32") {
        const m = /^([A-L])([12])$/.exec(src || "");
        if (m && groupStarted[m[1]]) { const row = stand(m[1])[Number(m[2]) - 1]; if (row) return { team: row.team, proj: true, src }; }
        if (/^3rd/.test(src || "") && winnerToThird) {
          const other = which === "home" ? f.srcAway : f.srcHome;
          const wm = /^([A-L])1$/.exec(other || "");
          const tg = wm && winnerToThird[wm[1]];
          const row = tg && stand(tg)[2];
          if (row) return { team: row.team, proj: true, src };
        }
        return { team: null, src };
      }
      const feeder = byId[which === "home" ? f.feedHome : f.feedAway];
      const t = f.round === "3P" ? loserOf(feeder) : winnerOf(feeder);
      return t ? { team: t, proj: true, src } : { team: null, src };
    }

    return {
      groupDone, winnerToThird, winnerOf, loserOf, side,
      teams: (f) => ({ home: side(f, "home").team, away: side(f, "away").team }),
    };
  }

  window.WC_ENGINE = { groupStandings, projector };
})();
