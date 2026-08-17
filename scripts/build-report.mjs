#!/usr/bin/env node
/**
 * build-report.mjs — turn a calculator state snapshot into report HTML for the kit renderer.
 *
 *   node scripts/build-report.mjs calc-state.json --mode=client   [--out FILE]
 *   node scripts/build-report.mjs calc-state.json --mode=partner  [--out FILE]
 *
 * then:
 *   python3 ~/.claude/skills/bitrix24-partner-style/scripts/render.py OUT.html --format a4
 *
 * MARKUP comes from the kit: assets/bitrix24-template.html component classes only
 * (.page/.page--sky/.page--partner-navy, .b24-runhead, .b24-h1, .b24-card--white,
 * .b24-table-wrap/.b24-table, .b24-checklist, .b24-quote, .b24-footer, .b24-btn ...).
 * Nothing is invented here and the kit is never edited.
 *
 * ASSET PATHS are kit-relative (bitrix24-logo/...) because render.py injects
 * <base href=".../skills/bitrix24-partner-style/assets/">.
 *
 * NO EMOJI: check marks come from .b24-checklist li.is-yes, which the kit backs with
 * badge-check.svg (brand-spec §5.3).
 *
 * PAGES ARE FIXED A4 with overflow:hidden (kit .page = height:297mm). Content does not
 * reflow — it is CLIPPED. So rows are chunked conservatively and a page is added rather
 * than squeezed. ROWS_PER_PAGE below is the knob.
 *
 * CLIENT VS PARTNER — the whole point of this script:
 *   client  : scenarios, saving, recommended plan + price, partner contacts, and the
 *             implementation fee as ONE total line.
 *   partner : the above PLUS the partner's service fees itemised per scenario.
 * A client build is audited before it is written (assertClientClean) and the script
 * REFUSES to emit a file that carries partner-only content.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const input = argv.find(a => !a.startsWith("--"));
const mode = (argv.find(a => a.startsWith("--mode=")) || "").split("=")[1];
const outArg = (argv.find(a => a.startsWith("--out=")) || "").split("=")[1];

if (!input || !["client", "partner"].includes(mode)) {
  console.error("usage: build-report.mjs STATE.json --mode=client|partner [--out=FILE]");
  process.exit(2);
}

const S = JSON.parse(fs.readFileSync(input, "utf8"));
const isPartner = mode === "partner";
const ROWS_PER_PAGE = 7;          // scenario rows per A4 sheet — deliberately conservative
const FIELD_ROWS_PER_PAGE = 5;    // scenario input blocks per A4 sheet

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LOC = S.lang === "de" ? "de-DE" : "en-US";
const money = n => new Intl.NumberFormat(LOC, { style: "currency", currency: S.currency, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const int = n => new Intl.NumberFormat(LOC).format(Math.round(n || 0));
/* one-decimal percent, identical rule to fmtPct1() on screen. The state carries the
   raw ratio; rounding happens here, on display, once. */
const pct1 = v => new Intl.NumberFormat(LOC, {maximumFractionDigits:1})
  .format(Math.round((v || 0) * 10) / 10);
const today = new Date(S.generatedAt || Date.now()).toLocaleDateString(LOC, { day: "numeric", month: "long", year: "numeric" });
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* =============================================================================
   ASSET EMBEDDING — why the report inlines its images
   The kit renderer injects <base href=".../partner-style/assets/">, so EVERY
   relative URL in this document resolves against the kit folder. That folder is a
   private skill: a partner who clones the public repo does not have it. Opening
   the built HTML in a browser therefore produced ten broken Bitrix24 lockups and
   a 404 on the stylesheet — in a workflow the README tells partners to use.
   Fix: the lockups travel as data URIs (immune to <base>, to where the file is
   moved, and to whether the kit exists), and the kit stylesheet is inlined from
   the vendored copy in assets/ so a raw browser open is still styled and A4.
   The <link> to the kit stays in <head> so the renderer keeps using the real
   font files; on a raw open it 404s harmlessly and the inlined copy takes over.
   ========================================================================== */
const KIT_MIME = {".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp"};
function dataUri(absPath){
  const ext = path.extname(absPath).toLowerCase();
  const mime = KIT_MIME[ext];
  if(!mime || !fs.existsSync(absPath)) return null;
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const asset = rel => path.join(REPO, "assets", rel);

/* the two lockups, embedded */
const LOCKUP = {
  dark:  dataUri(asset("logo-partner-h.png")),
  white: dataUri(asset("logo-partner-h-white.png")),
};
for (const [k,v] of Object.entries(LOCKUP))
  if(!v){ console.error(`build-report: missing assets/logo-partner-h${k==="white"?"-white":""}.png — the report would ship a broken lockup.`); process.exit(2); }

/* kit stylesheet, inlined, with its own icon references embedded too */
function inlinedKitCss(){
  const kit = asset("bitrix24-kit.css");
  if(!fs.existsSync(kit)){
    console.error("build-report: assets/bitrix24-kit.css is missing — a report opened outside the kit renderer would be unstyled.");
    process.exit(2);
  }
  let css = fs.readFileSync(kit, "utf8");
  /* embed the icons the kit paints as backgrounds (checklist badges) */
  css = css.replace(/url\("bitrix24-images\/icons\/([^"]+)"\)/g, (m, file) => {
    const uri = dataUri(asset(path.join("icons", file)));
    if (!uri) {
      /* Leaving the raw path in would ship a 404 into the report the moment the
         kit rule that uses it is hit. Vendor the icon instead of guessing. */
      console.error(`build-report: kit icon "${file}" is not vendored in assets/icons — `
                  + `copy it from the kit before building, or the report loads a broken image.`);
      process.exit(2);
    }
    return `url("${uri}")`;
  });
  /* Fonts. The kit points at seven static Montserrat files that only exist inside
     the kit folder. A partner working from the public repo has no kit and no
     renderer — browser print is their ONLY route to a PDF — so the brand font has
     to be in the file. Drop the seven @font-face rules and substitute the single
     vendored VARIABLE font, which covers every weight the kit asks for. */
  css = css.replace(/@font-face\s*\{[^}]*Montserrat[^}]*\}/g, "");
  const vf = asset("fonts/Montserrat-VariableFont_wght.ttf");
  if(fs.existsSync(vf)){
    const uri = `data:font/ttf;base64,${fs.readFileSync(vf).toString("base64")}`;
    css = `@font-face{font-family:'Montserrat';font-weight:100 900;font-style:normal;`
        + `src:url("${uri}") format('truetype-variations');font-display:swap;}\n` + css;
  } else {
    console.warn("build-report: assets/fonts/Montserrat-VariableFont_wght.ttf missing — "
               + "a browser-printed report will fall back to a system font.");
  }
  return css;
}

const T = S.totals, P = S.plan, PT = S.partner || {};
const partnerName = PT.company || "Bitrix24 Partner";
const clientName = S.company?.name || "";

/* ---------- CO-BRANDING ----------------------------------------------------
   The partner mark sits BESIDE the Bitrix24 Partners lockup, never merged with
   it: two separate marks with clear space between them. The clear space is the
   height of the clock glyph in the Bitrix24 mark — measured on the official file
   (1889x171, glyph 107px tall) at 0.63 of the lockup height. The lockup itself is
   untouched: official file, original colours, original proportions.
   partner.logo is a data URI or an absolute URL, so it resolves regardless of the
   <base> that render.py injects for the kit assets. Absent -> nothing is emitted
   and no gap is left behind.
   -------------------------------------------------------------------------- */
const partnerLogo = PT.logo && String(PT.logo).trim() ? String(PT.logo).trim() : null;

/* The Bitrix24 lockup keeps its kit class, so the kit owns its size and its own
   max-width guard (.b24-plogo). We only add a sibling and the clear space between
   them. maxW caps the partner mark so the pair can never outgrow the A4 content
   width — .page is overflow:hidden, and a clipped logo is worse than a small one. */
const cobrand = (lockup, kitClass, h, maxW) => `
  <span style="display:inline-flex; align-items:center; justify-content:flex-end;
               gap:${(h * 0.63).toFixed(1)}px; min-width:0; flex:0 1 auto;">
    <img class="b24-plogo ${kitClass}" src="${lockup}" alt="Bitrix24 Partners">
    ${partnerLogo ? `<img src="${esc(partnerLogo)}" alt="${esc(partnerName)}"
        style="max-height:${h}px; max-width:${maxW}px; height:auto; width:auto;
               object-fit:contain; display:block; flex:0 1 auto;">` : ""}
  </span>`;

const runhead = title => `
  <div class="b24-runhead">
    <span>${esc(partnerName)} — ${esc(title)}</span>
    ${cobrand(LOCKUP.dark, "b24-plogo--foot", 16, 80)}
  </div>`;
const footer = () => `
  <div class="b24-footer">
    <!-- footer keeps the Bitrix24 lockup alone: the partner mark is already in the
         running header on every page, and repeating it twice per sheet reads as
         clutter rather than co-branding. -->
    <img class="b24-plogo b24-plogo--foot" src="${LOCKUP.dark}" alt="Bitrix24 Partners">
    <span>${esc(partnerName)}${PT.email ? " · " + esc(PT.email) : ""} · Page <span class="b24-pageno"></span></span>
  </div>`;

/* ---------- page 1: cover ---------- */
const cover = () => `
<section class="page page--partner-navy page--flush" style="padding:var(--b24-page-pad);">
  <div class="b24-tetris" style="position:absolute; right:-50px; top:-50px; opacity:.55;"></div>
  <div class="b24-tetris--light b24-tetris b24-tetris--notch-bl" style="position:absolute; left:-55px; bottom:-55px; opacity:.15;"></div>
  <span class="b24-star" style="position:absolute; right:150px; top:150px; width:56px; height:56px;"></span>

  <div class="b24-plogo b24-plogo--cover" style="z-index:1;">
    ${cobrand(LOCKUP.white, "b24-plogo--cover", 30, 150)}
  </div>

  <div class="b24-content-z" style="margin-top:auto; margin-bottom:40px;">
    <span class="b24-pill" style="margin-bottom:22px;">${isPartner ? "Partner copy — internal" : "Value assessment"}</span>
    <h1 class="b24-display">What AI in Bitrix24 is<br>worth to <span class="b24-hl">${esc(clientName || "your business")}</span></h1>
    <p class="b24-lead" style="margin-top:22px; max-width:86%; font-size:17px;">
      ${int(S.items.length)} selected scenarios, costed on your own numbers.
      Annual payroll saving <span class="b24-hl">${money(T.fotYear)}</span>.
    </p>
    <p class="b24-lead" style="margin-top:26px; font-size:14px; opacity:.85;">
      ${esc(partnerName)} · ${esc(today)}
    </p>
  </div>
</section>`;

/* ---------- page 2: headline ---------- */
const headline = () => `
<section class="page page--sky">
  ${runhead("Headline")}
  <h1 class="b24-h1">The numbers</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>What</th><th>Month</th><th>Year</th></tr></thead>
      <tbody>
        <tr><td>Payroll saving</td><td>${money(T.fotMonth)}</td><td>${money(T.fotYear)}</td></tr>
        ${S.showRevenue && T.revMonth > 0 ? `<tr><td>Additional: revenue uplift (estimate)</td><td>${money(T.revMonth)}</td><td>${money(T.revMonth * 12)}</td></tr>` : ""}
        ${S.showRevenue && T.potMonth > 0 ? `<tr><td>Additional: existing-base potential (estimate)</td><td>${money(T.potMonth)}</td><td>${money(T.potMonth * 12)}</td></tr>` : ""}
      </tbody>
    </table>
  </div>

  <div class="b24-table-wrap" style="margin-top:var(--b24-s6)">
    <table class="b24-table">
      <thead><tr><th>First year</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>${esc(P.to)} subscription, year</td><td>− ${money(T.subscriptionYear)}</td></tr>
        <tr><td>Implementation services, one-off${T.serviceUnquoted
              ? ` — quoted for ${int(T.serviceQuoted)} of ${int(S.items.length)} scenarios`
              : ""}</td><td>− ${money(T.serviceSum)}</td></tr>
        <tr><td><strong>Total first-year cost</strong></td><td><strong>− ${money(T.firstYearCost)}</strong></td></tr>
        <tr><td><strong>Net first-year payroll saving</strong></td><td><strong>${money(T.netFirstYear)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  ${T.serviceUnquoted ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    ${int(T.serviceUnquoted)} scenario(s) are not yet priced, so the figure above is not the
    full implementation cost.</p>` : ""}

  ${overlapBlock()}

  <div class="b24-dashed" style="margin-top:var(--b24-s5)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      <span class="b24-strong">What this figure is:</span> the cost of the working time
      currently spent on these tasks. It is not profit, and not cash freed up.
    </p>
  </div>

  <div class="b24-quote">
    Payroll saving is the sum of the selected scenarios over twelve months. Day-driven
    scenarios are scaled to ${int(S.economics.daysMonth)} working days; the hourly cost of an
    employee comes from ${int(S.economics.contractHours)} contracted hours a month and a
    ${int(S.economics.burdenPct)}% employer payroll burden.
    ${S.showRevenue ? "Revenue figures are projections and are shown separately; they never enter the net saving." : "Revenue projections are excluded from this report."}
  </div>

  ${footer()}
</section>`;

/* Credibility warning — travels in BOTH builds. The client is entitled to know the
   estimate is above the level we consider defensible; hiding it would be the dishonest
   choice. Amber callout, never red. */
const overlapBlock = () => {
  const o = S.overlap;
  if (!o || o.ok) return "";
  return `
  <div class="b24-dashed" style="margin-top:var(--b24-s5); border-color:#A15C00;">
    <p class="b24-p" style="margin:0; font-size:13.5px; color:#A15C00;">
      <span class="b24-strong" style="color:#A15C00;">Estimate above the credibility limit.</span>
      The selected scenarios total ${pct1(o.pct)}% of the company's monthly payroll cost
      (${money(o.payrollMonth)}), above the ${int(o.threshold)}% limit this model treats as
      defensible. The scenarios most likely overlap — the same working hours counted more
      than once — so the coverage shares need review before these figures are relied on.
    </p>
  </div>`;
};

/* ---------- scenario overview table, chunked ---------- */
const scenarioPages = () => chunk(S.items, ROWS_PER_PAGE).map((rows, i, all) => `
<section class="page page--sky">
  ${runhead("Selected scenarios")}
  <h1 class="b24-h1">Selected scenarios${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>Scenario</th><th>Who</th><th>Coverage</th><th>Saving / month</th><th>Saving / year</th>${isPartner ? "<th>My services</th>" : ""}</tr></thead>
      <tbody>
        ${rows.map(it => `<tr>
          <td>${esc(it.title)}</td>
          <td>${esc(it.role)}</td>
          <td>${it.coverage === null ? "n/a" : int(it.coverage) + "%"}</td>
          <td>${money(it.fotMonth)}</td>
          <td>${money(it.fotYear)}</td>
          ${isPartner ? `<td>${it.service === null ? "not quoted" : money(it.service)}</td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  ${footer()}
</section>`).join("");

/* ---------- inputs used, chunked (transparency: the client can check our numbers) ---------- */
const inputPages = () => chunk(S.items, FIELD_ROWS_PER_PAGE).map((group, i, all) => `
<section class="page page--sky">
  ${runhead("Inputs used")}
  <h1 class="b24-h1">The numbers we entered${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>
  ${group.map(it => `
  <div class="b24-card b24-card--white" style="margin-bottom:var(--b24-s4); padding:var(--b24-s4) var(--b24-s5);">
    <p class="b24-label" style="margin:0 0 6px;">${esc(it.title)}</p>
    <p class="b24-p" style="margin:0; font-size:13px;">
      ${it.fields.map(f => `${esc(f.label)}: <span class="b24-strong">${esc(f.value)}</span>`).join(" · ")}
    </p>
  </div>`).join("")}
  ${footer()}
</section>`).join("");

/* ---------- plan recommendation (client-safe: names + prices only) ---------- */
const planPage = () => `
<section class="page page--sky">
  ${runhead("Recommended plan")}
  <h1 class="b24-h1">Recommended plan</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th></th><th>Plan</th><th>Per user / month, billed annually</th></tr></thead>
      <tbody>
        <tr><td>Currently</td><td>${esc(P.from)}</td>
            <td>${P.fromAnnualPerMonth == null ? "no " + esc(S.currency) + " price published" : money(P.fromAnnualPerMonth)}</td></tr>
        <tr><td>Recommended</td><td><strong>${esc(P.to)}</strong></td><td><strong>${money(P.toAnnualPerMonth)}</strong></td></tr>
      </tbody>
    </table>
  </div>

  <h1 class="b24-h1" style="margin-top:var(--b24-s8); font-size:22px;">What ${esc(P.to)} adds</h1>
  <ul class="b24-checklist">
    ${S.aiAllowance.map(a => `<li class="is-yes">${esc(a)}</li>`).join("")}
    <li class="is-yes">Vibecode — build custom AI-powered business apps</li>
    <li class="is-yes">MCP server — connect external AI agents to Bitrix24</li>
    <li class="is-yes">Unlimited REST API and Bitrix24 Market</li>
  </ul>

  <div class="b24-dashed" style="margin-top:var(--b24-s6)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      AI is positioned by plan, not by a request count — no per-request quotas are published,
      so no numeric AI limits are quoted here. Prices effective from ${esc(P.effectiveFrom)};
      existing clients keep current pricing until the end of their period or
      ${esc(P.grandfatheredUntil)}, whichever is later.
    </p>
  </div>
  ${footer()}
</section>`;

/* ---------- PARTNER-ONLY pages ----------
   The partner build adds the partner's own service fees. Programme economics
   (gap %, promo mechanics, margin) are not part of this build at all. */
const partnerServicePages = () => chunk(S.items, ROWS_PER_PAGE).map((rows, i, all) => `
<section class="page page--sky">
  ${runhead("My services — internal")}
  <h1 class="b24-h1">My services${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>
  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>Scenario</th><th>Fee</th></tr></thead>
      <tbody>
        ${rows.map(it => `<tr><td>${esc(it.title)}</td>
          <td>${it.service === null ? "not quoted" : money(it.service)}</td></tr>`).join("")}
        ${i === all.length - 1 ? `<tr><td><strong>Total — priced scenarios only, ${int(T.serviceQuoted)} of ${int(S.items.length)}</strong></td>
            <td><strong>${money(T.serviceSum)}</strong></td></tr>` : ""}
      </tbody>
    </table>
  </div>
  ${(i === all.length - 1 && T.serviceUnquoted) ? `<div class="b24-quote">
    ${int(T.serviceUnquoted)} scenario(s) left unpriced. They are excluded from the total and from
    the average — not counted as zero. Price them before sending the client a quote.</div>` : ""}
  ${footer()}
</section>`).join("");

/* ---------- closing CTA + partner contacts ---------- */
const closing = () => `
<section class="page page--partner-navy" style="text-align:center; align-items:center; justify-content:center;">
  <div class="b24-tetris" style="position:absolute; left:-50px; top:-50px; opacity:.5;"></div>
  <div class="b24-tetris--light b24-tetris b24-tetris--notch-tr" style="position:absolute; right:-55px; bottom:-55px; opacity:.14;"></div>

  <div class="b24-content-z" style="max-width:82%;">
    <h1 class="b24-display" style="font-size:38px;">Let's put this<br>into <span class="b24-hl">practice</span>.</h1>
    <p class="b24-lead" style="margin:22px auto 34px; font-size:17px; opacity:.92;">
      ${money(T.fotYear)} of payroll saving a year, on your own numbers.
      Next step is a working session on the scenarios you picked.
    </p>

    <div class="b24-card b24-card--navy" style="text-align:left; max-width:420px; margin:0 auto var(--b24-s8);">
      <p class="b24-label" style="margin:0 0 8px;">Your contact</p>
      <p class="b24-p" style="margin:0; font-size:15px;">
        <span class="b24-strong">${esc(PT.person || partnerName)}</span><br>
        ${PT.company ? esc(PT.company) + "<br>" : ""}
        ${PT.email ? esc(PT.email) + "<br>" : ""}
        ${PT.phone ? esc(PT.phone) + "<br>" : ""}
        ${PT.site ? esc(PT.site) : ""}
      </p>
    </div>
  </div>

  <div style="position:absolute; bottom:var(--b24-page-pad); left:50%; transform:translateX(-50%);">
    ${cobrand(LOCKUP.white, "b24-plogo--foot", 20, 110)}
  </div>
</section>`;

/* ---------- assemble ---------- */
const pages = [
  cover(),
  headline(),
  scenarioPages(),
  inputPages(),
  planPage(),
  isPartner ? partnerServicePages() : "",
  closing(),
].filter(Boolean).join("\n");

const html = `<!DOCTYPE html>
<html lang="${esc(S.lang || "en")}">
<head>
<meta charset="UTF-8">
<title>${esc(clientName || partnerName)} — AI value ${isPartner ? "assessment (partner copy)" : "assessment"}</title>
<style>
/* The kit stylesheet, inlined from the vendored copy in assets/ so the document
   stands on its own: correct A4 geometry, colours, badges and brand font with no
   external file. No <link> to the kit is emitted on purpose — render.py adds one
   itself when it does not find the name in the source, so the renderer still uses
   the kit directly and a raw browser open produces no 404 at all. */
${inlinedKitCss()}
</style>
<style>
  @media screen { body { padding: 24px 0; } }
  /* Soft CSS shadows are rasterized as a hard grey rectangle by macOS Preview /
     Quick Look. Replace them with a hairline. render.py injects the same reset,
     this keeps a standalone browser preview honest too. */
  .b24-card--white,.b24-table-wrap{box-shadow:none;border:1px solid var(--b24-line)}
</style>
</head>
<body>
${pages}
</body>
</html>
`;

/* =============================================================================
   CLIENT-BUILD AUDIT — refuse to write a leaking client report.
   The client gets ONE total line for implementation services. The itemised
   per-scenario fees, and any page marked as the partner copy, are the partner's
   business only.
   ========================================================================== */
/* Audit the VISIBLE TEXT, not the markup. Auditing raw HTML gives false positives:
   CSS declarations contain `margin:` and `gap:`, and class names contain `gap-rows`,
   none of which a client can read. So strip <style> blocks, then attributes, then tags. */
function visibleText(doc) {
  return doc
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[a-z][^>]*>/gi, m => m.replace(/\s+[a-z-]+\s*=\s*("[^"]*"|'[^']*')/gi, "")) // drop attributes
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function assertClientClean(doc) {
  const hay = visibleText(doc).toLowerCase();
  const banned = [
    ["itemised partner fees",   /my services/],
    ["unpriced-scenario marker",/not quoted/],
    ["partner copy marking",    /partner copy/],
    ["internal-use marking",    /internal use only/],
  ];
  const hits = banned.filter(([, re]) => re.test(hay)).map(([label]) => label);


  if (hits.length) {
    console.error("\n  REFUSED: client build would leak partner-only content:\n");
    hits.forEach(h => console.error("   - " + h));
    console.error("  Keep partner-only content inside the isPartner branches.\n");
    process.exit(1);
  }
}
if (!isPartner) assertClientClean(html);

const out = outArg || input.replace(/\.json$/, "") + `-report-${mode}.html`;
/* build/ is generated output and therefore gitignored, so it does not exist in a fresh
   clone. Create the directory rather than failing the first command a new user runs. */
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html, "utf8");

const pageCount = (html.match(/<section class="page/g) || []).length;
console.log(`build-report: ${mode} report -> ${path.relative(process.cwd(), out)}`);
console.log(`  pages            ${pageCount}`);
console.log(`  scenarios        ${S.items.length} (${ROWS_PER_PAGE}/page overview, ${FIELD_ROWS_PER_PAGE}/page inputs)`);
console.log(`  currency / lang  ${S.currency} / ${S.lang}`);
console.log(`  revenue shown    ${S.showRevenue}`);
console.log(isPartner
  ? `  partner page     yes (service fees ${money(T.serviceSum)})`
  : `  client audit     passed — no partner-only content`);
