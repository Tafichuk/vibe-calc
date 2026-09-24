#!/usr/bin/env node
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

const looksPreRounded = S.items.length > 1 && S.items.every(i => Number.isInteger(i.fotMonth));

const tmp = fs.mkdtempSync(path.join(ROOT, ".parity-"));
let report;
try {
  const out = path.join(tmp, "report.html");
  try {
    execFileSync(process.execPath,
      [path.join(ROOT, "scripts", "build-report.mjs"), STATE, `--out=${out}`],
      { stdio: "pipe" });
  } catch (e) {
    die(2, "check-parity: build-report.mjs failed — the report was not written.\n" +
           (e.stderr ? e.stderr.toString().slice(0, 900) : e.message));
  }
  report = fs.readFileSync(out, "utf8");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const visible = doc => doc
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

const D = S.display;
const reportText = visible(report);

const checks = [
  { what: "payroll saving / month",  screen: D.fotMonth },
  { what: "payroll saving / year",   screen: D.fotYear },
  { what: "Vibe+ subscription/year", screen: D.subscriptionYear },
  { what: "implementation services", screen: D.serviceSum },
  { what: "first-year cost",         screen: D.firstYearCost },
  { what: "net first-year saving",   screen: D.netFirstYear },
  { what: "plan price, current",     screen: D.planFromAnnual },
  { what: "plan price, target",      screen: D.planToAnnual },
];

if (/no published price|not published in/i.test(reportText))
  problems.push({ what: `the removed "no published price" state is back in the report`,
                  a: "every tier pair has a price, so the note must never print",
                  b: "(the report carries it)" });

for (const c of checks) {
  if (c.screen == null) continue;
  if (!reportText.includes(c.screen)) {
    const cur = (S.currency === "EUR" ? "€" : "$");
    const shown = [...reportText.matchAll(new RegExp(`\\${cur}[\\d.,]+`, "g"))].map(m => m[0]);
    problems.push({
      what: `${c.what} — missing from the report`,
      a: c.screen,
      b: shown.length ? `report shows: ${[...new Set(shown)].slice(0, 12).join(", ")}` : "(no figures found)",
    });
  }
}

const signedAmount = s => {
  if (s == null) return null;
  const str = String(s);
  const neg = /^[^\d]*[-\u2212]/.test(str);
  const digits = str.replace(/\D/g, "");
  if (!digits) return null;
  return neg ? -Number(digits) : Number(digits);
};
const diffInReport = text => {
  const m = text.match(/Difference[^$€\d]*?([-\u2212+]\s?)?([$€]\s?[\d.,\s]*\d)/);
  return m ? ((m[1] || "") + m[2]).replace(/\s+/g, " ").trim() : null;
};
if (D.diffPerMonth != null) {
  const want = signedAmount(D.diffPerMonth);
  const shown = diffInReport(reportText);
  if (signedAmount(shown) !== want)
    problems.push({ what: `plan difference next to its label`,
                    a: D.diffPerMonth, b: shown === null ? "(no Difference row found)" : shown,
                    note: "plan prices are per account; the difference must not be scaled by headcount" });
}

for (const p of (D.perScenario || [])) {
  if (p.hasFot === false) continue;
  if (!reportText.includes(p.fotMonth))
    problems.push({ what: `scenario ${p.id} saving/month — missing from the report`,
                    a: p.fotMonth, b: "(not found in report text)" });
  if (p.fotYear && !reportText.includes(p.fotYear))
    problems.push({ what: `scenario ${p.id} saving/year — missing from the report`,
                    a: p.fotYear, b: "(not found in report text)",
                    note: "the screen and the report must round by the same rule" });
}

if (S.showRevenue) {
  if (!/Revenue \/ month/.test(reportText))
    problems.push({ what: `revenue column missing`,
                    a: "the revenue switch is on",
                    b: "(no Revenue / month column in the scenario table)" });
  const revCellFor = (doc, title) => {
    const heads = [...(doc.match(/<thead>[\s\S]*?<\/thead>/g) || [])];
    const rows = doc.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    const cellsOf = r => [...r.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    let idx = -1;
    for (const h of heads) {
      const c = cellsOf(h);
      const i = c.findIndex(x => /^Revenue \/ month/.test(x));
      if (i >= 0 && c[0] === "Scenario") { idx = i; break; }
    }
    if (idx < 0) return {idx, cell: null};
    for (const r of rows) {
      const c = cellsOf(r);
      if (c.length > idx && c[0].startsWith(title)) return {idx, cell: c[idx]};
    }
    return {idx, cell: null};
  };
  for (const it of (S.items || [])) {
    const p = (D.perScenario || []).find(x => x.id === it.id);
    if (!p || p.hasRev === false || p.revMonth == null) continue;
    const {idx, cell} = revCellFor(report, it.title);
    if (idx < 0) continue;
    if (cell !== p.revMonth)
      problems.push({ what: `scenario ${it.id} revenue/month in its own row`,
                      a: p.revMonth,
                      b: cell === null ? "(no row found for this scenario)" : `report shows: ${cell}`,
                      note: "read from the scenario's own cell, not from anywhere in the document" });
  }
} else {
  if (/Revenue \/ month/.test(reportText))
    problems.push({ what: `revenue column present while the switch is off`,
                    a: "showRevenue is false", b: "(the scenario table carries a revenue column)" });
}

if ((D.perScenario || []).some(p => p.hasFot === false)) {
  if (!/in the saving columns/i.test(reportText))
    problems.push({ what: `dash note missing`,
                    a: "a row prints a dash instead of a payroll saving",
                    b: "(no line under the table explains it)" });
}

if (D.agentGatedFotYear) {
  if (!reportText.includes(D.agentGatedFotYear))
    problems.push({ what: `agent-gated saving in the report`,
                    a: D.agentGatedFotYear,
                    b: "(not found; the disclosure is missing or carries a different figure)" });
  for (const title of (S.agentGate?.titles || [])) {
    if (!reportText.includes(title))
      problems.push({ what: `agent-gated scenario missing from the report disclosure`,
                      a: title, b: "(not named in the report)" });
  }
}

if (S.realisation) {
  if (D.realisationCase == null)
    problems.push({ what: `realisation mode missing from display`,
                    a: "the state carries a realisation block",
                    b: "(display.realisationCase is null)" });
  else if (!reportText.includes(D.realisationCase))
    problems.push({ what: `realisation mode in the report`,
                    a: D.realisationCase,
                    b: "(not found; the report does not name the assumption the figures are built on)" });
  const share = `${S.realisation.pct}%`;
  if (!reportText.includes(share))
    problems.push({ what: `realisation share in the report`,
                    a: share,
                    b: "(not found; the report names the mode but not the share it applied)" });
}

if (S.capacity) {
  const C = S.capacity;
  for (const [what, screen] of [
    ["hours freed / month", D.capHoursMonth],
    ["hours freed / year",  D.capHoursYear],
  ]) {
    if (screen == null)
      problems.push({ what: `${what} missing from the state`, a: "the screen renders it", b: "(display carries null)" });
    else if (!reportText.includes(screen))
      problems.push({ what, a: screen, b: "(not found; the report is rounding hours differently)" });
  }
  if (D.capFte == null)
    problems.push({ what: "full-time equivalents missing from the state", a: "the screen renders it", b: "(display carries null)" });
  else if (!reportText.includes(`${D.capFte} full-time equivalents`))
    problems.push({ what: "full-time equivalents in the report",
                    a: `${D.capFte} full-time equivalents`,
                    b: "(not found; the report is rounding the equivalent differently)" });

  if (C.paybackBlocked === null) {
    if (D.capPayback == null)
      problems.push({ what: "payback missing from the state",
                      a: "every scenario is quoted, so the screen shows a payback",
                      b: "(display carries null)" });
    else if (!reportText.includes(D.capPayback))
      problems.push({ what: "payback in the report", a: D.capPayback,
                      b: "(not found; the report picked a different unit or rounding)" });
  } else {
    if (D.capPayback != null)
      problems.push({ what: "payback exported while it is blocked",
                      a: `capacity.paybackBlocked is "${C.paybackBlocked}"`,
                      b: `(display carries ${D.capPayback})` });
    if (/\bPayback\b[\s\S]{0,40}?\d+(\.\d+)?\s+(weeks|months)/.test(reportText))
      problems.push({ what: "payback printed while it is blocked",
                      a: `capacity.paybackBlocked is "${C.paybackBlocked}" — the first-year cost is incomplete`,
                      b: "(the report prints a payback figure anyway)" });
  }
  if (!/Cash effect/.test(reportText))
    problems.push({ what: "cash-effect line missing from the report",
                    a: "the screen shows it as a dash with the reason",
                    b: "(the report does not mention the cash effect at all)" });
  if (C.sensitivityText && !reportText.includes(C.sensitivityText))
    problems.push({ what: "sensitivity line differs from the screen",
                    a: C.sensitivityText,
                    b: "(not found; the report is wording it differently)" });
}

const HARD_MARK = "limit this model treats as credible";
const SOFT_MARK = "Above the usual range";
if (S.overlap && !S.overlap.ok) {
  if (!reportText.includes(D.overlapPct))
    problems.push({ what: `overlap warning percentage`,
                    a: D.overlapPct, b: "(not found; warning missing or differently rounded)" });

  if (S.overlap.source && !reportText.includes(S.overlap.source))
    problems.push({ what: `credibility range provenance line`,
                    a: S.overlap.source,
                    b: "(not found; the report states a range without saying where it comes from)" });

  if (S.overlap.level === "soft") {
    if (!reportText.includes(SOFT_MARK))
      problems.push({ what: `soft credibility note missing`,
                      a: `overlap.level is "soft" (${D.overlapPct} of payroll)`,
                      b: `(the report carries no "${SOFT_MARK}" block)` });
    if (reportText.includes(HARD_MARK))
      problems.push({ what: `hard warning printed for a soft-level calculation`,
                      a: `overlap.level is "soft" — the figure is above the usual range, not implausible`,
                      b: `(the report claims the estimate is above the credibility limit)` });
    if (S.overlap.noteText && !reportText.includes(S.overlap.noteText))
      problems.push({ what: `soft note wording differs from the screen`,
                      a: S.overlap.noteText,
                      b: "(not found; the report is wording the same warning differently)" });
  }
  if (S.overlap.level === "hard") {
    if (!reportText.includes(HARD_MARK))
      problems.push({ what: `hard credibility warning missing`,
                      a: `overlap.level is "hard" (${D.overlapPct} of payroll)`,
                      b: `(the report carries no credibility-limit block)` });
    if (reportText.includes(SOFT_MARK))
      problems.push({ what: `soft note printed alongside the hard warning`,
                      a: `overlap.level is "hard" — exactly one block may print`,
                      b: "(the report carries both)" });
  }
} else if (S.overlap && S.overlap.level === "ok") {
  for (const [mark, what] of [[SOFT_MARK, "soft note"], [HARD_MARK, "hard warning"]])
    if (reportText.includes(mark))
      problems.push({ what: `${what} printed while both thresholds are silent`,
                      a: `overlap.level is "ok" (${D.overlapPct} of payroll)`,
                      b: `(the report carries the "${mark}" block anyway)` });
}

if (S.revGuard && !S.revGuard.ok) {
  for (const [what, screen] of [
    ["revenue warning percentage",       D.revGuardPct],
    ["revenue warning pool, year",       D.revGuardPool],
    ["revenue warning projection, year", D.revGuardProjected],
  ]) {
    if (screen == null)
      problems.push({ what: `${what} missing from the state`,
                      a: "the guard fired, so the screen must export the figure",
                      b: "(display carries null)" });
    else if (!reportText.includes(screen))
      problems.push({ what, a: screen,
                      b: "(not found; warning missing or differently rounded)" });
  }
}

let seatGuard = null;
if (S.company && S.company.empCount) {
  const scaled = JSON.parse(JSON.stringify(S));
  scaled.company.empCount = S.company.empCount * 3;
  const tmp2 = fs.mkdtempSync(path.join(ROOT, ".parity-seats-"));
  const scaledFile = path.join(tmp2, "scaled.json");
  fs.writeFileSync(scaledFile, JSON.stringify(scaled));
  try {
    const out = path.join(tmp2, "report.html");
    try {
      execFileSync(process.execPath,
        [path.join(ROOT, "scripts", "build-report.mjs"), scaledFile, `--out=${out}`],
        { stdio: "pipe" });
    } catch (e) {
      die(2, "check-parity: build-report.mjs failed on the tripled-headcount state\n" +
             (e.stderr ? e.stderr.toString().slice(0, 600) : e.message));
    }
    const text = visible(fs.readFileSync(out, "utf8"));
    if (D.diffPerMonth != null) {
      const shown = diffInReport(text);
      if (signedAmount(shown) !== signedAmount(D.diffPerMonth))
        problems.push({ what: `plan difference changed when headcount tripled`,
                        a: `${D.diffPerMonth} at ${S.company.empCount} users`,
                        b: `${shown === null ? "(no Difference row)" : shown} at ${scaled.company.empCount} users`,
                        note: "plan cost is per account and must not scale with seats" });
    }
    for (const [label, figure] of [["target plan price", D.planToAnnual],
                                   ["current plan price", D.planFromAnnual],
                                   ["subscription/year", D.subscriptionYear]]) {
      if (figure == null) continue;
      if (!text.includes(figure))
        problems.push({ what: `${label} changed when headcount tripled`,
                        a: `${figure} at ${S.company.empCount} users`,
                        b: `missing at ${scaled.company.empCount} users`,
                        note: "plan cost is per account and must not scale with seats" });
    }
    seatGuard = `${S.company.empCount} and ${scaled.company.empCount} users`;
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}

if (problems.length) {
  console.error(`\n  PARITY FAILURE — the screen and the report disagree (${problems.length}):\n`);
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

console.log(`check-parity: OK — the screen and the report agree`);
console.log(`  state            ${path.relative(ROOT, STATE)}`);
console.log(`  scenarios        ${S.items.length}`);
console.log(`  saving / month   ${D.fotMonth}`);
console.log(`  saving / year    ${D.fotYear}`);
console.log(`  first-year cost  ${D.firstYearCost}`);
console.log(`  net first year   ${D.netFirstYear}`);
if (seatGuard) console.log(`  headcount guard  plan cost identical at ${seatGuard}`);
else           console.log(`  headcount guard  SKIPPED — state has no company.empCount`);
console.log(`  checks run       ${checks.filter(c=>c.screen!=null).length} totals`
            + ` + ${(D.perScenario||[]).length} per-scenario`
            + (S.overlap && !S.overlap.ok ? " + overlap warning" : "")
            + (S.revGuard && !S.revGuard.ok ? " + revenue warning" : ""));
if (looksPreRounded)
  console.log(`  note             every per-scenario value is a whole number — check that the`
              + `\n                   producer is not rounding before summing`);
