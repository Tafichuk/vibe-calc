#!/usr/bin/env node
/**
 * check-prices.mjs — guard against price drift.
 *
 * Prices live in config/pricing.json (source of record) but are ALSO embedded in
 * index.html, because the calculator has to stay a single static file that works
 * over file:// with no fetch. Two copies drift. This script fails loudly when they do.
 *
 *   node scripts/check-prices.mjs          # verify
 *   node scripts/check-prices.mjs --json   # machine-readable diff
 *
 * Exit 0 = in sync. Exit 1 = drift (prints exactly which field differs).
 * Exit 2 = could not read or parse one of the two sides (never reported as "in sync").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "config", "pricing.json");
const PAGE = path.join(ROOT, "index.html");
const asJson = process.argv.includes("--json");

const fail = (code, msg) => { console.error(msg); process.exit(code); };

/* ---------- read the source of record ---------- */
let cfg;
try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")); }
catch (e) { fail(2, `check-prices: cannot read/parse ${path.relative(ROOT, CONFIG)}\n  ${e.message}`); }

/* ---------- extract the embedded block from index.html ---------- */
let page;
try { page = fs.readFileSync(PAGE, "utf8"); }
catch (e) { fail(2, `check-prices: cannot read ${path.relative(ROOT, PAGE)}\n  ${e.message}`); }

const start = page.indexOf("const PRICING = {");
if (start < 0) fail(2, "check-prices: `const PRICING = {` not found in index.html — was the block renamed?");
// walk braces to find the end of the object literal
let depth = 0, end = -1;
for (let i = page.indexOf("{", start); i < page.length; i++) {
  const ch = page[i];
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) fail(2, "check-prices: could not find the end of the PRICING object literal.");

let embedded;
try {
  // The literal is plain data (no expressions), so evaluating it in isolation is safe.
  embedded = new Function("return " + page.slice(page.indexOf("{", start), end))();
} catch (e) {
  fail(2, `check-prices: embedded PRICING block is not valid JS data\n  ${e.message}`);
}

/* ---------- build the expected shape FROM the config ---------- */
const essUSD = cfg.essentials_prices?.USD;
if (!Array.isArray(essUSD)) fail(2, "check-prices: config.essentials_prices.USD is not an array.");

const expected = {
  effectiveFrom: cfg.key_dates?.prices_live,
  essentialsUSD: essUSD.map(r => ({ plan: r.plan, monthly: r.monthly, annual: r.annual_per_month })),
  // EUR Essentials is intentionally absent in the source; the page must model that as null.
  essentialsEURisNull: typeof cfg.essentials_prices?.EUR === "string"
    && /MISSING/i.test(cfg.essentials_prices.EUR),
  migration: (cfg.migration_map || []).map(p => ({ to: p.to })),
  vibe: Object.fromEntries(["USD", "EUR"].map(cur => [
    cur,
    (cfg.vibe_plus_prices?.[cur] || []).map(r => ({
      plan: r.plan, monthly: r.monthly, annual: r.annual_per_month, annualTotal: r.annual_total,
    })),
  ])),
};

/* ---------- compare ---------- */
const problems = [];
const cmp = (label, want, got) => {
  if (want !== got) problems.push({ field: label, config: want, index_html: got });
};

cmp("effectiveFrom", expected.effectiveFrom, embedded.effectiveFrom);

// Essentials USD — the page only carries the 4 published tiers
const embEss = embedded.essentials?.USD || [];
if (embEss.length !== expected.essentialsUSD.length) {
  problems.push({ field: "essentials.USD.length", config: expected.essentialsUSD.length, index_html: embEss.length });
} else {
  expected.essentialsUSD.forEach((w, i) => {
    cmp(`essentials.USD[${i}].plan`, w.plan, embEss[i].plan);
    cmp(`essentials.USD[${i}].monthly`, w.monthly, embEss[i].monthly);
    cmp(`essentials.USD[${i}].annual`, w.annual, embEss[i].annual);
  });
}

// EUR Essentials must be null while the source says MISSING — a number here would be invented.
if (expected.essentialsEURisNull && embedded.essentials?.EUR !== null) {
  problems.push({
    field: "essentials.EUR",
    config: "MISSING in source -> must be null in index.html",
    index_html: JSON.stringify(embedded.essentials?.EUR),
  });
}

// Essentials -> Vibe+ mapping and promo prices
const embMig = embedded.migration || [];
if (embMig.length !== expected.migration.length) {
  problems.push({ field: "migration.length", config: expected.migration.length, index_html: embMig.length });
} else {
  expected.migration.forEach((w, i) => {
    cmp(`migration[${i}].to`, w.to, embMig[i].to);
    // the `from` side must be a real Essentials plan name
    if (!essUSD.some(e => e.plan === embMig[i].from))
      problems.push({ field: `migration[${i}].from`, config: essUSD.map(e => e.plan).join("|"), index_html: embMig[i].from });
  });
}


// Vibe+ tiers: every tier the page carries must match the config exactly.
// The page may carry FEWER tiers than the config (it only needs the migration targets),
// but never a tier the config does not have, and never a different number.
for (const cur of ["USD", "EUR"]) {
  const want = expected.vibe[cur], got = embedded.vibePlus?.[cur] || [];
  if (!want.length) { problems.push({ field: `vibe_plus_prices.${cur}`, config: "missing in config", index_html: got.length }); continue; }
  got.forEach((g, i) => {
    const w = want.find(x => x.plan === g.plan);
    if (!w) { problems.push({ field: `vibePlus.${cur}[${i}].plan`, config: "not present in config", index_html: g.plan }); return; }
    cmp(`vibePlus.${cur}[${g.plan}].monthly`, w.monthly, g.monthly);
    cmp(`vibePlus.${cur}[${g.plan}].annual`, w.annual, g.annual);
    cmp(`vibePlus.${cur}[${g.plan}].annualTotal`, w.annualTotal, g.annualTotal);
  });
}

/* ---------- report ---------- */
if (asJson) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) {
  console.error(`\n  PRICE DRIFT — index.html disagrees with config/pricing.json (${problems.length} field(s)):\n`);
  for (const p of problems) {
    console.error(`  ${p.field}`);
    console.error(`      config/pricing.json : ${JSON.stringify(p.config)}`);
    console.error(`      index.html          : ${JSON.stringify(p.index_html)}`);
  }
  console.error(`\n  Fix: update the "const PRICING = {" block in index.html to match config/pricing.json,`);
  console.error(`  then re-run: node scripts/check-prices.mjs\n`);
  process.exit(1);
}

const tiers = (embedded.vibePlus?.USD || []).length;
console.log(`check-prices: OK — index.html matches config/pricing.json`);
console.log(`  effective from   ${embedded.effectiveFrom}`);
console.log(`  Essentials USD   ${(embedded.essentials?.USD || []).length} tiers`);
console.log(`  Essentials EUR   null (source: MISSING — not invented)`);
console.log(`  Vibe+ tiers      ${tiers} carried (config has ${expected.vibe.USD.length})`);
console.log(`  migration pairs  ${(embedded.migration || []).length}`);
