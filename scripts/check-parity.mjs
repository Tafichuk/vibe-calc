#!/usr/bin/env node
/**
 * check-parity.mjs — the screen and the reports must show the SAME numbers.
 *
 *   node scripts/check-parity.mjs [STATE.json]        # default: calc-state.json
 *
 * Exit 0 = every checked quantity matches across screen / client report / partner
 *          report. Exit 1 = a mismatch, naming the quantity and all three values.
 * Exit 2 = could not run the comparison (never reported as "matching").
 *
 * HOW IT COMPARES
 * The calculator exports `display`: the exact strings it is rendering at the moment
 * of export. This script builds both report modes from the same state and pulls the
 * corresponding figures out of the generated HTML. If a report re-derives a figure
 * instead of displaying the model's, or rounds an intermediate, the strings differ
 * and this fails.
 *
 * It also re-checks the state for INTERNAL consistency: the totals must equal the
 * sum over the raw per-scenario values. That catches rounding creeping back into
 * the producer even if both surfaces happen to agree with each other.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateArg = process.argv.slice(2).find(a => !a.startsWith("--"));
const STATE = path.resolve(ROOT, stateArg || "calc-state.json");

const die = (code, msg) => { console.error(msg); process.exit(code); };

let S;
try { S = JSON.parse(fs.readFileSync(STATE, "utf8")); }
catch (e) { die(2, `check-parity: cannot read/parse ${path.relative(ROOT, STATE)}\n  ${e.message}`); }

if (!S.display) {
  die(2, `check-parity: ${path.relative(ROOT, STATE)} has no "display" block.\n` +
         `  Re-export the state from the calculator (button "Export data for the report").\n` +
         `  Without it there is nothing to compare the reports against.`);
}

/* ---------- 1. is the state internally consistent? (no rounded intermediates) ---------- */
const problems = [];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const sumFot = S.items.reduce((a, i) => a + i.fotMonth, 0);
if (!near(sumFot, S.totals.fotMonth))
  problems.push({ what: "totals.fotMonth vs sum(items.fotMonth)",
                  a: String(S.totals.fotMonth), b: String(sumFot),
                  note: "totals must be the sum of RAW per-scenario values" });
if (!near(S.totals.fotYear, S.totals.fotMonth * 12))
  problems.push({ what: "totals.fotYear vs fotMonth x 12",
                  a: String(S.totals.fotYear), b: String(S.totals.fotMonth * 12) });
if (!near(S.totals.firstYearCost, S.totals.subscriptionYear + S.totals.serviceSum))
  problems.push({ what: "totals.firstYearCost vs subscription + services",
                  a: String(S.totals.firstYearCost),
                  b: String(S.totals.subscriptionYear + S.totals.serviceSum) });
if (!near(S.totals.netFirstYear, S.totals.fotYear - S.totals.firstYearCost))
  problems.push({ what: "totals.netFirstYear vs fotYear - firstYearCost",
                  a: String(S.totals.netFirstYear),
                  b: String(S.totals.fotYear - S.totals.firstYearCost) });

/* An integer-valued fotMonth on a set that should carry cents is the classic symptom
   of rounding in the producer. Warn only — it can legitimately be whole. */
const looksPreRounded = S.items.length > 1 && S.items.every(i => Number.isInteger(i.fotMonth));

/* ---------- 2. build both reports from this state ---------- */
const tmp = fs.mkdtempSync(path.join(ROOT, ".parity-"));
const built = {};
try {
  for (const mode of ["client", "partner"]) {
    const out = path.join(tmp, `${mode}.html`);
    try {
      execFileSync(process.execPath,
        [path.join(ROOT, "scripts", "build-report.mjs"), STATE, `--mode=${mode}`, `--out=${out}`],
        { stdio: "pipe" });
    } catch (e) {
      die(2, `check-parity: build-report.mjs failed for --mode=${mode}\n` +
             (e.stderr ? e.stderr.toString().slice(0, 900) : e.message));
    }
    built[mode] = fs.readFileSync(out, "utf8");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* visible text of a report, so CSS and markup cannot create false matches */
const visible = doc => doc
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

/* ---------- 3. compare the screen's strings against each report ---------- */
const D = S.display;

/* Each check: the quantity, the string the SCREEN shows, and whether a report is
   expected to show it at all (the client build omits partner-only figures). */
const checks = [
  { what: "payroll saving / month",  screen: D.fotMonth,         in: ["client", "partner"] },
  { what: "payroll saving / year",   screen: D.fotYear,          in: ["client", "partner"] },
  { what: "Vibe+ subscription/year", screen: D.subscriptionYear, in: ["client", "partner"] },
  { what: "implementation services", screen: D.serviceSum,       in: ["client", "partner"] },
  { what: "first-year cost",         screen: D.firstYearCost,    in: ["client", "partner"] },
  { what: "net first-year saving",   screen: D.netFirstYear,     in: ["client", "partner"] },
  { what: "plan price, current",     screen: D.planFromAnnual,   in: ["client", "partner"] },
  { what: "plan price, target",      screen: D.planToAnnual,     in: ["client", "partner"] },
  /* The pair is now chosen freely (any Essentials or "no Bitrix24 yet" against any
     of the 15 Vibe+ tiers), so the difference is no longer derivable from the plan
     names — it has to travel and match. When the "before" price is not published
     the screen sends null and there is nothing to compare. */
  { what: "plan price difference",   screen: D.diffPerUserMonth, in: ["client", "partner"] },
];

/* With no published "before" price, both reports must SAY so rather than quietly
   dropping the row — that is the whole point of the honest-gap rule. */
if (S.plan && S.plan.fromPriceKnown === false) {
  for (const mode of ["client", "partner"]) {
    const text = visible(built[mode]);
    if (!/no published price|not published in/i.test(text))
      problems.push({ what: `missing "no published price" note — ${mode} report`,
                      a: "expected an explicit note next to the plan table",
                      b: "(report shows neither)" });
  }
}

for (const c of checks) {
  if (c.screen == null) continue;                 // not applicable (e.g. no price published)
  for (const mode of c.in) {
    const text = visible(built[mode]);
    if (!text.includes(c.screen)) {
      // find what the report shows instead, for a useful message
      const cur = (S.currency === "EUR" ? "€" : "$");
      const shown = [...text.matchAll(new RegExp(`\\${cur}[\\d.,]+`, "g"))].map(m => m[0]);
      problems.push({
        what: `${c.what} — missing from ${mode} report`,
        a: c.screen,
        b: shown.length ? `report shows: ${[...new Set(shown)].slice(0, 12).join(", ")}` : "(no figures found)",
      });
    }
  }
}

/* per-scenario figures must match too — that is where the rounding used to differ */
for (const p of (D.perScenario || [])) {
  for (const mode of ["client", "partner"]) {
    const text = visible(built[mode]);
    if (!text.includes(p.fotMonth))
      problems.push({ what: `scenario ${p.id} saving/month — missing from ${mode} report`,
                      a: p.fotMonth, b: "(not found in report text)" });
  }
}

/* the credibility warning, when it is on, must carry the same percentage */
if (S.overlap && !S.overlap.ok) {
  for (const mode of ["client", "partner"]) {
    const text = visible(built[mode]);
    if (!text.includes(`${D.overlapPct}%`))
      problems.push({ what: `overlap warning percentage — ${mode} report`,
                      a: `${D.overlapPct}%`, b: "(not found; warning missing or differently rounded)" });
  }
}

/* ---------- report ---------- */
if (problems.length) {
  console.error(`\n  PARITY FAILURE — the screen and a report disagree (${problems.length}):\n`);
  for (const p of problems) {
    console.error(`  ${p.what}`);
    console.error(`      screen : ${p.a}`);
    console.error(`      report : ${p.b}`);
    if (p.note) console.error(`      note   : ${p.note}`);
  }
  console.error(`\n  Every figure must come from computeModel() and be rounded only on display.`);
  console.error(`  If a report derives its own value, or the state was exported with rounded`);
  console.error(`  intermediates, this is what it looks like.\n`);
  process.exit(1);
}

console.log(`check-parity: OK — screen, client report and partner report agree`);
console.log(`  state            ${path.relative(ROOT, STATE)}`);
console.log(`  scenarios        ${S.items.length}`);
console.log(`  saving / month   ${D.fotMonth}`);
console.log(`  saving / year    ${D.fotYear}`);
console.log(`  first-year cost  ${D.firstYearCost}`);
console.log(`  net first year   ${D.netFirstYear}`);
console.log(`  checks run       ${checks.filter(c=>c.screen!=null).length} totals x2 builds`
            + ` + ${(D.perScenario||[]).length} per-scenario x2`
            + (S.overlap && !S.overlap.ok ? " + overlap warning" : ""));
if (looksPreRounded)
  console.log(`  note             every per-scenario value is a whole number — check that the`
              + `\n                   producer is not rounding before summing`);
