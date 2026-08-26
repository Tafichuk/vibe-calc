#!/usr/bin/env node
/**
 * check-parity.mjs — the screen and the reports must show the SAME numbers.
 *
 *   node scripts/check-parity.mjs [STATE.json]        # default: calc-state.json
 *
 * Exit 0 = every checked quantity matches between the screen and the report.
 * Exit 1 = a mismatch, naming the quantity and both values.
 * Exit 2 = could not run the comparison (never reported as "matching").
 *
 * ONE REPORT. There used to be two builds, client and partner, and every check ran
 * twice. The partner build is gone — the partner works from the screen — so there is
 * one document to compare against. Nothing was dropped in the collapse: every
 * quantity that was checked in both builds is still checked, once.
 * The leak guard did not move either. build-report.mjs audits the report and REFUSES
 * to write a file carrying internal material, so a leak makes the build fail and this
 * script dies at step 2 with that message rather than quietly comparing figures.
 *
 * HOW IT COMPARES
 * The calculator exports `display`: the exact strings it is rendering at the moment
 * of export. This script builds the report from the same state and pulls the
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

/* ---------- 2. build the report from this state ---------- */
/* Сборка одна. Если build-report.mjs откажется её писать — а он отказывается,
   когда в документ попало внутреннее, — мы падаем ЗДЕСЬ с его текстом, а не идём
   сверять цифры в файле, которого нет. Это и есть лик-гейт на стороне parity. */
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

/* visible text of a report, so CSS and markup cannot create false matches */
const visible = doc => doc
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

/* ---------- 3. compare the screen's strings against the report ---------- */
const D = S.display;
const reportText = visible(report);

/* Each check: the quantity and the string the SCREEN shows. The `in:` field is gone
   with the second build — there is one report and every quantity below belongs in
   it. */
const checks = [
  { what: "payroll saving / month",  screen: D.fotMonth },
  { what: "payroll saving / year",   screen: D.fotYear },
  { what: "Vibe+ subscription/year", screen: D.subscriptionYear },
  { what: "implementation services", screen: D.serviceSum },
  { what: "first-year cost",         screen: D.firstYearCost },
  { what: "net first-year saving",   screen: D.netFirstYear },
  { what: "plan price, current",     screen: D.planFromAnnual },
  { what: "plan price, target",      screen: D.planToAnnual },
  /* The pair is now chosen freely (any Essentials or "no Bitrix24 yet" against any
     of the 15 Vibe+ tiers), so the difference is no longer derivable from the plan
     names — it has to travel and match. When the "before" price is not published
     the screen sends null and there is nothing to compare. */
  /* plan price difference НЕ проверяется здесь вхождением строки: у пары с
     понижением экран печатает «-$30», а отчёт «− $30», и это разные строки при
     одном и том же числе. Настоящая проверка — позиционная, рядом с подписью
     Difference, и она строже: см. diffInReport() ниже. */
];

/* Проверка «отчёт обязан сказать, что цены нет» удалена вместе с самим состоянием:
   официальная выгрузка Антона закрыла все пятнадцать тиров Essentials, разница
   считается для любой пары, и печатать «no published price» стало нечему.
   Обратный предохранитель на её месте: этой строки в отчёте быть НЕ должно —
   если она всплывёт, значит где-то вернулась ветка, которую мы убрали. */
if (/no published price|not published in/i.test(reportText))
  problems.push({ what: `the removed "no published price" state is back in the report`,
                  a: "every tier pair has a price, so the note must never print",
                  b: "(the report carries it)" });

for (const c of checks) {
  if (c.screen == null) continue;                 // not applicable (e.g. no price published)
  if (!reportText.includes(c.screen)) {
    // find what the report shows instead, for a useful message
    const cur = (S.currency === "EUR" ? "€" : "$");
    const shown = [...reportText.matchAll(new RegExp(`\\${cur}[\\d.,]+`, "g"))].map(m => m[0]);
    problems.push({
      what: `${c.what} — missing from the report`,
      a: c.screen,
      b: shown.length ? `report shows: ${[...new Set(shown)].slice(0, 12).join(", ")}` : "(no figures found)",
    });
  }
}

/* The loose "figure appears somewhere in the document" test is not enough for the
   plan difference: a report that multiplies it by headcount simply prints another
   number, and the absence of the right one is all we would learn. Read the figure
   that sits next to the "Difference" label and compare it exactly.

   СРАВНИВАЕМ ЧИСЛО СО ЗНАКОМ, А НЕ СТРОКУ, и это не послабление, а исправление
   ложного срабатывания. Экран печатает отрицательную разницу через Intl —
   «-$30». Отчёт разводит знак и сумму и ставит настоящий минус: «− $30» (U+2212).
   Расхождение в форме тут СДЕЛАНО НАРОЧНО: пока знак был частью числа, у пары с
   понижением выходило «+ -$220». А пары с понижением реальны — Standard за $99
   против Alaio Basic Vibe+ за $69 даёт −$30. Проверка строк объявляла такую пару
   расхождением, хотя обе стороны показывают одно и то же число. Величина и знак
   сверяются по-прежнему строго, вплоть до единицы. */
const signedAmount = s => {
  if (s == null) return null;
  const str = String(s);
  const neg = /^[^\d]*[-\u2212]/.test(str);        // минус ДО первой цифры
  const digits = str.replace(/\D/g, "");           // money() печатает без копеек
  if (!digits) return null;
  return neg ? -Number(digits) : Number(digits);
};
const diffInReport = text => {
  /* Пропуск до суммы ЛЕНИВЫЙ: жадный [^$€\d]* съедал бы сам минус вместе со
     словом «downgrade» перед ним, и отрицательная разница читалась бы как
     положительная — ровно та ошибка, которую эта проверка должна ловить. */
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

/* per-scenario figures must match too — that is where the rounding used to differ */
for (const p of (D.perScenario || [])) {
  /* Сценарий с эффектом только на выручку экономии ФОТ не имеет вообще. Экран не
     показывает по нему суммы нигде, отчёт печатает прочерк — сверять с «$0»
     нечего, и раньше это совпадение проходило само собой, потому что «$0»
     встречается в документе где угодно. hasFot отсутствует у состояний, снятых
     до появления признака: там поведение прежнее. */
  if (p.hasFot === false) continue;
  if (!reportText.includes(p.fotMonth))
    problems.push({ what: `scenario ${p.id} saving/month — missing from the report`,
                    a: p.fotMonth, b: "(not found in report text)" });
  /* И ГОДОВАЯ ТОЖЕ. Сверялась только месячная, а в таблице сценариев стоят обе
     колонки. Дырой это перестало быть теоретическим на сценарии 11: ровно
     $65,487.50 в год печаталось как $65,487, потому что month*12 в двоичной
     арифметике чуть меньше половины. Экран и отчёт тогда совпадали (правило
     округления одно), но стоит правилу разъехаться между ними — а живут они в
     двух функциях, fmtMoney и money, — и заметить это было бы нечем.
     fotYear отсутствует у состояний, снятых до его появления: там как раньше. */
  if (p.fotYear && !reportText.includes(p.fotYear))
    problems.push({ what: `scenario ${p.id} saving/year — missing from the report`,
                    a: p.fotYear, b: "(not found in report text)",
                    note: "the screen and the report must round by the same rule" });
}

/* КОЛОНКА ВЫРУЧКИ. Появляется в таблице сценариев ТОЛЬКО при включённом
   переключателе — и тогда обязана нести по сценарию ту же цифру, которую печатает
   карточка на экране, а не только общий итог на первой странице. Проверяется в обе
   стороны: включён — колонка есть, выключен — колонки нет. */
if (S.showRevenue) {
  if (!/Revenue \/ month/.test(reportText))
    problems.push({ what: `revenue column missing`,
                    a: "the revenue switch is on",
                    b: "(no Revenue / month column in the scenario table)" });
  /* Читаем ИМЕННО ячейку строки сценария. «Цифра есть где-то в документе» здесь не
     работает: при включённом переключателе те же суммы стоят общим итогом на первой
     странице, поэтому удвоенное значение в колонке такую проверку проходит —
     проверено подстановкой money(it.rev * 2), тест молчал. Та же причина, по которой
     разницу тарифов ниже читают рядом с её подписью. */
  const revCellFor = (doc, title) => {
    const heads = [...(doc.match(/<thead>[\s\S]*?<\/thead>/g) || [])];
    const rows = doc.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    const cellsOf = r => [...r.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    /* индекс колонки берём из шапки таблицы сценариев, а не по счёту руками */
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
    if (idx < 0) continue;                         // отсутствие колонки уже поймано выше
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

/* Прочерк без объяснения — такая же ловушка, как «$0»: в таблице появляется знак,
   которого читатель не заказывал. Если хоть один сценарий печатается прочерком,
   отчёт обязан нести подпись под таблицей. */
if ((D.perScenario || []).some(p => p.hasFot === false)) {
  if (!/in the saving columns/i.test(reportText))
    problems.push({ what: `dash note missing`,
                    a: "a row prints a dash instead of a payroll saving",
                    b: "(no line under the table explains it)" });
}

/* РАСХОЖДЕНИЕ ПО AI-АГЕНТАМ. Экран называет сумму, которая на выбранной цели
   недоступна; отчёт обязан назвать ТУ ЖЕ сумму. Проверяется только когда
   расхождение есть — у состояния без него строки нет вовсе.
   Отсутствие самого раскрытия ловит не здесь, а аудит в build-report.mjs: он
   отказывается писать файл, и тогда этот скрипт падает раньше, на шаге 2. Тут
   сверяется величина, чтобы отчёт не назвал своё число. */
if (D.agentGatedFotYear) {
  if (!reportText.includes(D.agentGatedFotYear))
    problems.push({ what: `agent-gated saving in the report`,
                    a: D.agentGatedFotYear,
                    b: "(not found; the disclosure is missing or carries a different figure)" });
  /* И состав: экран перечисляет недоступные сценарии, отчёт обязан перечислить
     их же. «Сумма совпала» без имён — половина раскрытия. */
  for (const title of (S.agentGate?.titles || [])) {
    if (!reportText.includes(title))
      problems.push({ what: `agent-gated scenario missing from the report disclosure`,
                      a: title, b: "(not named in the report)" });
  }
}

/* РЕЖИМ РЕАЛИЗАЦИИ. Экран называет допущение, на котором построена каждая цифра;
   документ обязан назвать ТО ЖЕ допущение и теми же словами. Расчёт без этой
   пометки — то же самое, что отчёт без бейджа «estimate»: цифра выглядит
   измеренной и ею не является.
   Проверяются обе величины, а не только имя: доля обязана совпасть с той, что
   стоит на экране, иначе документ назовёт режим правильно и посчитает по
   другому. Ветка условная — состояния, снятые до появления переключателя, блока
   не несут и печатать им нечего. */
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

/* the credibility warning, when it is on, must carry the same percentage */
if (S.overlap && !S.overlap.ok) {
  /* Знак процента теперь ВНУТРИ строки display.overlapPct: экранный fmtPct1
     печатает «208.3%», отчёт — pct1()+«%», то есть то же самое. Раньше здесь
     дописывался ещё один «%», и проверка искала «208.3 %%» — совпасть это не
     могло никогда. Не срабатывало только потому, что у штатной фикстуры
     предохранитель выключен и до этой ветки дело не доходило. */
  if (!reportText.includes(D.overlapPct))
    problems.push({ what: `overlap warning percentage`,
                    a: D.overlapPct, b: "(not found; warning missing or differently rounded)" });
}

/* ПРЕДУПРЕЖДЕНИЕ ПО ВЫРУЧКЕ — тем же порядком, что и предупреждение о перекрытии.
   Проверяются ТРИ величины, а не одна: доля, пул и сам прогноз. Одной доли мало —
   «61.4%» может уцелеть в документе, пока обе суммы под ней разъехались, и
   читатель получит правдоподобный процент от неверных денег.
   Ветка идёт только когда предохранитель сработал: у состояния, где он молчит,
   строк нет ни на экране, ни в отчёте, и искать нечего. */
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

/* ---------- 4. the cost of the move must NOT depend on headcount ----------
   Plan prices are for the whole account: from Enterprise-1000 up the published price
   scales exactly with the seat count in the tier name, so the seats are already inside
   the figure. Multiplying the difference by the client's headcount double-counts them —
   the bug this guard exists to stop from coming back ("+ $108,000 across 50 users"
   where the real figure was $2,160 a year).

   Behavioural, not textual: rebuild the report from the same state with the headcount
   tripled and demand every plan figure comes out identical. Only payroll may move. */
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

/* ---------- report ---------- */
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
/* Печатаем только когда предохранитель действительно прогнан: строка о проверке,
   которой не было, — хуже отсутствия строки. */
if (seatGuard) console.log(`  headcount guard  plan cost identical at ${seatGuard}`);
else           console.log(`  headcount guard  SKIPPED — state has no company.empCount`);
console.log(`  checks run       ${checks.filter(c=>c.screen!=null).length} totals`
            + ` + ${(D.perScenario||[]).length} per-scenario`
            + (S.overlap && !S.overlap.ok ? " + overlap warning" : "")
            + (S.revGuard && !S.revGuard.ok ? " + revenue warning" : ""));
if (looksPreRounded)
  console.log(`  note             every per-scenario value is a whole number — check that the`
              + `\n                   producer is not rounding before summing`);
