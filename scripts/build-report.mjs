#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const input = argv.find(a => !a.startsWith("--"));
const outArg = (argv.find(a => a.startsWith("--out=")) || "").split("=")[1];
const mode = (argv.find(a => a.startsWith("--mode=")) || "").split("=")[1];

if (!input) {
  console.error("usage: build-report.mjs STATE.json [--out=FILE]");
  process.exit(2);
}
if (mode === "partner") {
  console.error("\n  build-report: the partner build was removed — there is one report and it is the client's.");
  console.error("  Drop --mode=partner. The partner's own economics stay on screen and are not printed.\n");
  process.exit(2);
}
if (mode && mode !== "client") {
  console.error(`build-report: unknown --mode=${mode}. There is one report; --mode=client is accepted and means nothing.`);
  process.exit(2);
}

const S = JSON.parse(fs.readFileSync(input, "utf8"));

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LOC = S.lang === "de" ? "de-DE" : "en-US";
const money = n => new Intl.NumberFormat(LOC, { style: "currency", currency: S.currency, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const int = n => new Intl.NumberFormat(LOC).format(Math.round(n || 0));
const pct1 = v => new Intl.NumberFormat(LOC, {maximumFractionDigits:1})
  .format(Math.round((v || 0) * 10) / 10);
const today = new Date(S.generatedAt || Date.now()).toLocaleDateString(LOC, { day: "numeric", month: "long", year: "numeric" });
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

import { LOCKUP, inlinedKitCss } from "./lib/brand-assets.mjs";

for (const [k, v] of Object.entries(LOCKUP))
  if (!v) {
    console.error("build-report: missing assets/logo-partner-h"
                + (k === "white" ? "-white" : "") + ".png — the report would ship a broken lockup.");
    process.exit(2);
  }

import { buildReport } from "./report-template.mjs";

const { html, pageCount, hits, missing, blocked } = buildReport(S, {
  assets: {
    lockupDark:  LOCKUP.dark,
    lockupWhite: LOCKUP.white,
    styleTags: `<style>
${inlinedKitCss()}
</style>`,
    baseHref: null,
  },
});

const T = S.totals, P = S.plan;

if (blocked && blocked.length) {
  console.error("\n  REFUSED: the calculation carries an input error, so the report would be");
  console.error("  built on a set of scenarios the partner did not actually get:\n");
  blocked.forEach(m => console.error("   - " + m));
  console.error("\n  Fix the flagged field in the calculator and export the state again.\n");
  process.exit(1);
}

if (missing && missing.length) {
  console.error("\n  REFUSED: the report is built on scenarios that the recommended plan does not");
  console.error("  include, and it does not say so. Missing:\n");
  missing.forEach(m => console.error("   - " + m));
  console.error("\n  AI agents are available from Alaio Professional Vibe+ up. A report that shows");
  console.error("  their saving without naming the requirement sells the client a plan on which");
  console.error("  the promise does not hold. Add the disclosure — do not remove the guard.\n");
  process.exit(1);
}

if (hits.length) {
  console.error("\n  REFUSED: the report would carry internal, partner-only content:\n");
  hits.forEach(h => console.error("   - " + h));
  console.error("  There is one report and it goes to the client, so there is nowhere");
  console.error("  for internal material to go.\n");
  process.exit(1);
}

const out = outArg || input.replace(/\.json$/, "") + "-report.html";
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html, "utf8");

console.log(`build-report: report -> ${path.relative(process.cwd(), out)}`);
console.log(`  pages            ${pageCount}`);
console.log(`  scenarios        ${S.items.length}`);
console.log(`  currency / lang  ${S.currency} / ${S.lang}`);
console.log(`  revenue shown    ${S.showRevenue}`);
console.log(`  services total   ${money(T.serviceSum)} (one line among the first-year costs)`);
console.log(`  audit            passed — no gap %, no promo mechanics, no partner levels, no per-scenario fees`);
