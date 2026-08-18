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
   ========================================================================== */const KIT_MIME = {".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp"};
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

/* =============================================================================
   РАЗМЕТКА — из scripts/report-template.mjs. Здесь остаётся только окружение:
   чем подставить логотипы и стили. Ровно та же функция строит отчёт в браузере
   (кнопки «скачать PDF» на шаге 8) — поэтому версии не могут разъехаться.
   ========================================================================== */
import { buildReport } from "./report-template.mjs";

const { html, pageCount, hits } = buildReport(S, {
  mode,
  assets: {
    lockupDark:  LOCKUP.dark,
    lockupWhite: LOCKUP.white,
    /* The kit stylesheet, inlined from the vendored copy in assets/ so the document
       stands on its own: correct A4 geometry, colours, badges and brand font with no
       external file. No <link> to the kit is emitted on purpose — render.py adds one
       itself when it does not find the name in the source, so the renderer still uses
       the kit directly and a raw browser open produces no 404 at all. */
    styleTags: `<style>
/* The kit stylesheet, inlined from the vendored copy in assets/ so the document
   stands on its own: correct A4 geometry, colours, badges and brand font with no
   external file. No <link> to the kit is emitted on purpose — render.py adds one
   itself when it does not find the name in the source, so the renderer still uses
   the kit directly and a raw browser open produces no 404 at all. */
${inlinedKitCss()}
</style>`,
    baseHref: null,
  },
});

const T = S.totals, P = S.plan;

if (hits.length) {
  console.error("\n  REFUSED: client build would leak partner-only content:\n");
  hits.forEach(h => console.error("   - " + h));
  console.error("  Keep partner-only content inside the isPartner branches.\n");
  process.exit(1);
}

const out = outArg || input.replace(/\.json$/, "") + `-report-${mode}.html`;
/* build/ is generated output and therefore gitignored, so it does not exist in a fresh
   clone. Create the directory rather than failing the first command a new user runs. */
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html, "utf8");

console.log(`build-report: ${mode} report -> ${path.relative(process.cwd(), out)}`);
console.log(`  pages            ${pageCount}`);
console.log(`  scenarios        ${S.items.length}`);
console.log(`  currency / lang  ${S.currency} / ${S.lang}`);
console.log(`  revenue shown    ${S.showRevenue}`);
console.log(isPartner
  ? `  partner page     yes (service fees ${money(T.serviceSum)})`
  : `  client audit     passed — no partner-only content`);
