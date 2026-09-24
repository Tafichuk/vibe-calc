#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "config", "pricing.json");
const PAGE = path.join(ROOT, "index.html");
const asJson = process.argv.includes("--json");

const fail = (code, msg) => { console.error(msg); process.exit(code); };

let cfg;
try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")); }
catch (e) { fail(2, `check-prices: cannot read/parse ${path.relative(ROOT, CONFIG)}\n  ${e.message}`); }

let page;
try { page = fs.readFileSync(PAGE, "utf8"); }
catch (e) { fail(2, `check-prices: cannot read ${path.relative(ROOT, PAGE)}\n  ${e.message}`); }

const start = page.indexOf("const PRICING = {");
if (start < 0) fail(2, "check-prices: `const PRICING = {` not found in index.html — was the block renamed?");
let depth = 0, end = -1;
for (let i = page.indexOf("{", start); i < page.length; i++) {
  const ch = page[i];
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) fail(2, "check-prices: could not find the end of the PRICING object literal.");

let embedded;
try {
  embedded = new Function("return " + page.slice(page.indexOf("{", start), end))();
} catch (e) {
  fail(2, `check-prices: embedded PRICING block is not valid JS data\n  ${e.message}`);
}

const essUSD = cfg.essentials_prices?.USD;
if (!Array.isArray(essUSD)) fail(2, "check-prices: config.essentials_prices.USD is not an array.");

const expected = {
  effectiveFrom: cfg.key_dates?.prices_live,
  lineupFrom: cfg.key_dates?.lineup_live,
  grandfatheredUntil: cfg.key_dates?.existing_clients_grandfathered_until,
  essentialsUSD: essUSD.map(r => ({ plan: r.plan, monthly: r.monthly, annual: r.annual_per_month,
                                    seats: r.seats })),
  essentialsEURisNull: cfg.essentials_prices?.EUR == null
    || (typeof cfg.essentials_prices.EUR === "string" && /MISSING/i.test(cfg.essentials_prices.EUR)),
  migration: (cfg.migration_map || []).map(p => ({ to: p.to })),
  vibe: Object.fromEntries(["USD", "EUR"].map(cur => [
    cur,
    (cfg.vibe_plus_prices?.[cur] || []).map(r => ({
      plan: r.plan, monthly: r.monthly, annual: r.annual_per_month, annualTotal: r.annual_total,
    })),
  ])),
};

const problems = [];
const cmp = (label, want, got) => {
  if (want !== got) problems.push({ field: label, config: want, index_html: got });
};

cmp("effectiveFrom", expected.effectiveFrom, embedded.effectiveFrom);
cmp("lineupFrom", expected.lineupFrom, embedded.lineupFrom);
cmp("grandfatheredUntil", expected.grandfatheredUntil, embedded.grandfatheredUntil);
[["lineupFrom", expected.lineupFrom], ["grandfatheredUntil", expected.grandfatheredUntil]]
  .forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")))
      problems.push({ field: `key_dates -> ${k} (source)`, config: "must be a bare YYYY-MM-DD date", index_html: v });
  });

const embEss = embedded.essentials?.USD || [];
if (embEss.length !== expected.essentialsUSD.length) {
  problems.push({ field: "essentials.USD.length", config: expected.essentialsUSD.length, index_html: embEss.length });
} else {
  expected.essentialsUSD.forEach((w, i) => {
    cmp(`essentials.USD[${i}].plan`, w.plan, embEss[i].plan);
    cmp(`essentials.USD[${i}].annual`, w.annual, embEss[i].annual);
    cmp(`essentials.USD[${i}].seats`, w.seats, embEss[i].seats);
    const wantHas = w.monthly != null, gotHas = embEss[i].monthly != null;
    if (wantHas !== gotHas)
      problems.push({ field: `essentials.USD[${i}].monthly (${w.plan})`,
                      config: wantHas ? `published: ${w.monthly}` : "NOT published in source",
                      index_html: gotHas ? `${embEss[i].monthly} — invented` : "absent" });
    else if (wantHas) cmp(`essentials.USD[${i}].monthly`, w.monthly, embEss[i].monthly);
  });
}

if (expected.essentialsEURisNull && embedded.essentials?.EUR !== null) {
  problems.push({
    field: "essentials.EUR",
    config: "MISSING in source -> must be null in index.html",
    index_html: JSON.stringify(embedded.essentials?.EUR),
  });
}

const embMig = embedded.migration || [];
if (embMig.length !== expected.migration.length) {
  problems.push({ field: "migration.length", config: expected.migration.length, index_html: embMig.length });
} else {
  expected.migration.forEach((w, i) => {
    cmp(`migration[${i}].to`, w.to, embMig[i].to);
    if (!essUSD.some(e => e.plan === embMig[i].from))
      problems.push({ field: `migration[${i}].from`, config: essUSD.map(e => e.plan).join("|"), index_html: embMig[i].from });
  });
}


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

const wantDelta = cfg.vibe_plus_delta_by_tier || {};
const gotDelta = embedded.vibeDelta || {};
const deltaTiers = Object.keys(wantDelta).filter(k => !k.startsWith("_"));
if (!deltaTiers.length) {
  problems.push({ field: "vibe_plus_delta_by_tier", config: "missing in config", index_html: "n/a" });
} else {
  const gotTiers = Object.keys(gotDelta);
  if (deltaTiers.join(",") !== gotTiers.join(",")) {
    problems.push({ field: "vibeDelta tiers", config: deltaTiers.join(","), index_html: gotTiers.join(",") });
  } else {
    deltaTiers.forEach(tier => {
      const w = wantDelta[tier], g = gotDelta[tier] || [];
      if (!Array.isArray(w)) { problems.push({ field: `vibeDelta.${tier}`, config: "not an array", index_html: typeof g }); return; }
      if (w.length !== g.length) {
        problems.push({ field: `vibeDelta.${tier}.length`, config: w.length, index_html: g.length }); return;
      }
      w.forEach((line, i) => cmp(`vibeDelta.${tier}[${i}]`, line, g[i]));
    });
  }
  const CYR = /[\u0400-\u04FF]/;
  [["config", wantDelta], ["index.html", gotDelta]].forEach(([where, obj]) => {
    Object.entries(obj).forEach(([k, arr]) => {
      if (k.startsWith("_") || !Array.isArray(arr)) return;
      arr.forEach((line, i) => {
        if (CYR.test(line))
          problems.push({ field: `vibeDelta.${k}[${i}] (${where}): Cyrillic letter inside a Latin name`,
                          config: "Latin letters only", index_html: line });
      });
    });
  });
}

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
console.log(`  effective from   ${embedded.effectiveFrom} (price list) · lineup live ${embedded.lineupFrom} · transition ends ${embedded.grandfatheredUntil}`);
console.log(`  Essentials USD   ${(embedded.essentials?.USD || []).length} tiers`
          + ` (monthly published for ${expected.essentialsUSD.filter(r=>r.monthly!=null).length},`
          + ` seat tiers ${expected.essentialsUSD.filter(r=>r.seats).map(r=>r.seats).join("/")})`);
console.log(`  Essentials EUR   null (source has no EUR Essentials — not invented)`);
console.log(`  Vibe+ tiers      ${tiers} carried (config has ${expected.vibe.USD.length})`);
console.log(`  migration pairs  ${(embedded.migration || []).length}`);
console.log(`  Vibe+ delta      ${deltaTiers.length} tier sets, ${deltaTiers.reduce((n, k) => n + (wantDelta[k] || []).length, 0)} official rows from the comparison page`);
