#!/usr/bin/env node
/* Server-side results updater. Fetches from TheSportsDB and bakes the results
   into data.js, reusing the exact same merge logic as the in-browser live.js.
   Run it manually (`node update.js`) or on a schedule (see the GitHub Action).
   Requires Node 18+ (for global fetch). */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const dir = __dirname;
const sandbox = { window: {}, console, Date, fetch: globalThis.fetch, setTimeout, URL };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, "data.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, "live.js"), "utf8"), sandbox);

(async () => {
  const D = sandbox.window.WC_DATA;
  if (!sandbox.window.WC_LIVE) { console.error("live.js did not load"); process.exit(1); }
  const r = await sandbox.window.WC_LIVE.fetchAndMerge(D);
  if (!r.ok) { console.error("Live fetch failed:", r.error || JSON.stringify(r)); process.exit(1); }

  const header =
    "// World Cup 2026 Sweepstake — data file.\n" +
    "// Edit results here, then refresh the page. See README.md for the schema.\n" +
    "// Auto-updated by update.js. Add \"lock\": true to a fixture to protect a\n" +
    "// manual edit from being overwritten by live data.\n";
  fs.writeFileSync(path.join(dir, "data.js"), header + "window.WC_DATA = " + JSON.stringify(D, null, 2) + ";\n");
  console.log(`data.js updated — ${r.finished} finished result(s) merged from ${r.events} event(s).`);
})();
