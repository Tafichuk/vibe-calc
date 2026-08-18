# AI Value Calculator for Bitrix24 — Vibe+ edition

A calculator you fill in **together with your client** to show what AI in Bitrix24 is
actually worth to their business, and what moving from Essentials to Alaio Vibe+ costs.
It ends in a PDF report you can leave with them.

Built for Bitrix24 partners in western markets. English, USD.

**[Open the calculator →](https://tafichuk.github.io/vibe-calc/)**

---

## What it does

Pick the scenarios that match the client's business, enter their real numbers, and the
calculator works out the payroll saving AI produces — then puts the cost of getting there
next to it.

- **11 scenarios** in four groups: CRM, AI agents, general, Vibecode and CoPilot.
- **Essentials → Alaio Vibe+** side by side, with the difference in money: per user per
  month, per user per year, and across the whole seat count.
- **Two PDF reports** — one for the client, one for you.
- **No backend, no build, no tracking.** One HTML file that runs offline.

### What it deliberately does not do

- It does **not** promise revenue. Revenue uplift is off by default, because it is a
  projection: it assumes freed time converts into sales. Payroll saving does not depend
  on that assumption. You can switch it on, knowingly.
- It does **not** invent AI limits. Bitrix24 publishes no per-request quotas, so the
  calculator states the allowance qualitatively and never quotes a request or token count.
- It does **not** claim more than it can defend. See the credibility guard below.

---

## Run it

Download or clone, then open `index.html` in a browser. That is the whole procedure —
no `npm install`, no server, no internet connection required. It works from `file://` on
a laptop in flight mode, which is how you will most often use it.

```bash
git clone https://github.com/Tafichuk/vibe-calc.git
cd vibe-calc
open index.html          # macOS;  Linux: xdg-open  ·  Windows: start
```

## Put it on your own site

It is one self-contained page, so hosting is trivial.

1. **Fork** this repository.
2. In your fork: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
3. A minute later it is live at `https://<your-account>.github.io/vibe-calc/`.

Or just copy `index.html`, `css/` and `assets/` onto any static hosting you already have.
There is nothing to configure.

---

## How the calculation works

Worth understanding before you quote anything from it.

**Payroll saving, not profit.** Every scenario converts time an employee no longer spends
on routine into money, at that employee's hourly cost:

```
hourly cost = gross salary × (1 + employer payroll burden) ÷ contracted hours per month
```

Payroll saving is freed working time priced out. It is not cash in the bank unless the
company reuses that time or stops hiring. Say so out loud — a finance director will ask.

**Coverage — the number that keeps it honest.** Each scenario has a coverage share: the
proportion of staff it genuinely touches. Without it, every scenario claims the whole
company and the same working day gets counted four times over. Defaults are deliberately
conservative (12–30% for broad scenarios, 100% for role-scoped ones) and marked
`estimate`. Lower them until they match who will really use the feature.

**Three kinds of scenario**, which decides whether working days affect it:

| Driver | Means | Scales with working days |
|---|---|---|
| `daily` | minutes saved per person per day | yes |
| `monthly` | a fixed volume of events per month | no |
| `share` | a share of the employee's monthly cost | no |

**The credibility guard.** The calculator continuously compares the total saving with the
company's whole payroll cost. Above 25% it shows a warning — and puts it in both reports.
25% of payroll is roughly ten hours a week removed from every employee; real
cross-functional AI rollouts land in the single digits to low teens. Past that threshold
the scenarios are almost certainly overlapping. The warning never blocks the calculation:
you may have a defensible case, and it stays your call.

**Nothing is selected when the page loads.** That is on purpose. You choose each scenario
consciously, so the client never sees a total nobody picked. An honest short list is more
persuasive than a long one.

**Everything marked `estimate` is a placeholder.** Salaries, payroll burden, working days,
coverage — all of it. Replace with the client's real figures before you quote.

---

## Making it yours

| What | Where |
|---|---|
| **Scenarios** — add, remove, retune formulas | the `scenarios` array in `index.html` |
| **Your service fees** | filled in per scenario in the UI, no defaults on purpose |
| **Your contacts** | the "Your details" block; they go into the report header and footer |
| **Colours, type, components** | `css/brand-ext.css` |
| **Prices** | `config/pricing.json`, mirrored into the `PRICING` block in `index.html` |
| **Wording, any language** | the `I18N` object in `index.html` |

**Your service fees have no defaults, and that is intentional.** A made-up figure quoted
to a client is worse than a blank. An empty field means *not quoted* — it is skipped by
the total and the average rather than silently counted as zero. A deliberate 0 ("I'll set
this one up for free") is a real quote and does count.

**Another language?** `I18N` has an `en` branch and a `de` stub. Missing keys fall back to
English, so a translator only has to add keys — nothing else changes. Numbers and currency
format themselves from the active locale.

**Styling.** Design tokens are copied from the Bitrix24 partner brand kit into the
`<style>` block; form components and state colours live in `css/brand-ext.css`. Put your
changes there. Three brand rules are easy to break by accident: the accent green
`#BDF300` is a background only and never text (green text on white is unreadable), dark
panels use the partner radial gradient rather than flat navy, and check marks come from
the kit's badge SVGs — no emoji.

---

## Prices

`config/pricing.json` holds client-facing prices for Essentials and Alaio Vibe+ and is the
source of record. They are also embedded in `index.html`, because the page has to stay a
single file that works offline. Two copies drift, so there is a guard:

```bash
node scripts/check-prices.mjs      # exit 0 in sync, 1 with the exact field that differs
```

Update `config/pricing.json`, mirror the change into the `PRICING` block in `index.html`,
re-run until it passes.

> **Current prices and partner terms come from the Bitrix24 Partner Portal.**
> The figures here are a snapshot for calculation, they carry no warranty, and they will
> go stale. Partner-programme economics — your margin by partner level, migration promo
> terms and similar — are not in this repository at all, by design. Get them from the
> Partner Portal, where they are kept current and where you are already authenticated.

---

## Getting the PDF report

**From the page, with nothing installed.** Fill the calculator in and press one of the two
buttons in the last step:

| Button | What you get |
|---|---|
| **Client report — PDF** | the client-facing build |
| **Partner report — PDF** | the same plus your service fees per scenario |

Each button lays the report out as A4 pages and opens your browser's print dialog —
choose **Save as PDF** as the destination. That dialog is the only way a web page can
write a file to your disk, and it is also what keeps the text real text: selectable,
searchable, printed with the Bitrix24 font instead of a screenshot. Verified in Chrome,
Safari and Firefox: 210×297 mm pages, nothing clipped, fonts embedded.

The **Save calculation (JSON)** button next to them is not a report — it is your work
saved so you can reopen it later ("Open a saved calculation") or hand it to a colleague.

### From the terminal, if you prefer

Same report, same markup — the page and the script share `scripts/report-template.mjs`,
so the two cannot drift apart:

```bash
# press "Save calculation (JSON)", then:
node scripts/build-report.mjs calc-state.json --mode=client  --out=build/report-client.html
node scripts/build-report.mjs calc-state.json --mode=partner --out=build/report-partner.html
```

Then render each to A4 with the Bitrix24 partner brand kit renderer, or print the HTML
from the browser — the pages are already A4-sized.

A `calc-state.json` is included as a worked example: five scenarios, a 50-person company.

### The two builds differ

| | Client report | Partner report |
|---|---|---|
| Scenarios, saving, coverage | yes | yes |
| Recommended plan and price | yes | yes |
| Implementation services | one total line | itemised per scenario |
| Credibility warning | yes | yes |

The client build is audited before it is written: `build-report.mjs` checks the visible
text and **refuses to produce the file** if partner-only content appears in it. Keep your
own additions inside the `isPartner` branches.

---

## Checks

```bash
node scripts/check-prices.mjs      # embedded prices match config/pricing.json
node scripts/check-parity.mjs      # the screen and both reports show the same numbers
```

`check-parity.mjs` guards one rule that is easy to break: every figure comes from
`computeModel()` and is rounded **only on display**. Intermediate values are never
rounded — round a per-scenario result and every total built on it inherits the error.
If you add a figure to a report, display the model's value; don't re-derive it.

---

## Credits and licence

The scenario set and the calculation approach come from the original Russian-language
calculator by [BelMihMed](https://github.com/BelMihMed/calc-serv). This is a western
edition: coverage, the credibility guard, day-driver tagging and the two-mode report
were added on top, and the pricing model was rebuilt for the Essentials → Vibe+ move.

Code is MIT. **Bitrix24 names, logos and visual identity are not covered by it** and
remain the property of their owner — they are included so partner-facing output looks
right; replace them if you fork this for something else. Montserrat is under the SIL Open
Font License. See [LICENSE](LICENSE).

Issues and pull requests welcome. Please don't open issues asking for partner pricing or
margin figures — those belong in the Partner Portal, not here.
