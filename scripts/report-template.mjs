
export function buildReport(S, {assets}) {
  const ROWS_PER_PAGE = 7;
  const FIELD_ROWS_PER_PAGE = 5;

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LOC = S.lang === "de" ? "de-DE" : "en-US";
  const toWhole = n => Math.round(Math.round((n || 0) * 100) / 100);
  const fixMinus = str => String(str).replace(/^-/, "\u2212");
  const money = n => fixMinus(new Intl.NumberFormat(LOC, { style: "currency", currency: S.currency, maximumFractionDigits: 0 }).format(toWhole(n)));
  const int = n => new Intl.NumberFormat(LOC).format(toWhole(n));
  const pct1 = v => new Intl.NumberFormat(LOC, {maximumFractionDigits:1})
    .format(Math.round((v || 0) * 10) / 10);
  const today = new Date(S.generatedAt || Date.now()).toLocaleDateString(LOC, { day: "numeric", month: "long", year: "numeric" });
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const noFot = it => it.hasFot === false;
  const DASH = "\u2014";
  const showRev = !!S.showRevenue;
  const noRev = it => it.hasRev === false;
  const R = S.realisation || null;
  const realCase = R ? R.case : null;
  const CAP = S.capacity || null;
  const hours = n => `${int(n)} h`;
  const fte1 = n => new Intl.NumberFormat(LOC, {minimumFractionDigits:1, maximumFractionDigits:1})
    .format(Math.round((n || 0) * 10) / 10);
  const wideTable = showRev;
  const gate = S.agentGate || null;
  const gated = gate && !gate.planHasAgents ? (gate.ids || []) : [];
  const gatedIds = new Set(gated);
  const isGated = it => gatedIds.has(it.id);
  const AGENT_SCENARIO_IDS = new Set([5, 10, 11]);
  const AGENT_PLAN_RE = /^Alaio (?:Professional|Enterprise-\d+) Vibe\+$/;
  const planCarriesAgents = AGENT_PLAN_RE.test(String((S.plan || {}).to || ""));
  const agentItems = (S.items || []).filter(it => AGENT_SCENARIO_IDS.has(it.id));
  const disclosureRequired = !planCarriesAgents && agentItems.length > 0;
  const GATE_MARK = "\u2020";

  const segCount = it => 1 + (it.segments || []).length;
  const chunkByWeight = (arr, budget, weight) => {
    const o = []; let cur = [], load = 0;
    for (const it of arr) {
      const w = weight(it);
      if (cur.length && load + w > budget) { o.push(cur); cur = []; load = 0; }
      cur.push(it); load += w;
    }
    if (cur.length) o.push(cur);
    return o;
  };

const T = S.totals, P = S.plan, PT = S.partner || {};

const partnerName = PT.company || "Bitrix24 Partner";
const clientName = S.company?.name || "";

const partnerLogo = PT.logo && String(PT.logo).trim() ? String(PT.logo).trim() : null;

const logoInk = PT.logoInk === "light" || PT.logoInk === "dark" ? PT.logoInk : null;

const plateStyle = (ink, padVar, darkPage) =>
    `background:${ink === "light" ? "var(--b24p-deep-2)" : "var(--b24-white)"};`
  + `padding:var(${padVar}); border-radius:var(--b24-r-tile);`
  + (ink === "light" && darkPage ? "border:1px solid rgba(255,255,255,.22);" : "")
  + "display:inline-flex; align-items:center; flex:0 0 auto;";

const cobrand = (lockup, kitClass, h, maxW, {onDark = false, padVar = "--b24-s3"} = {}) => {
  const ink = logoInk;
  const plated = onDark && !!partnerLogo && !!ink;
  const mark = partnerLogo
    ? `<img src="${esc(partnerLogo)}" alt="${esc(partnerName)}"
        style="max-height:${h}px; max-width:${maxW}px; height:auto; width:auto;
               object-fit:contain; display:block; flex:0 1 auto;">`
    : "";
  const plate = plateStyle(ink, padVar, true);
  return `
  <span style="display:inline-flex; align-items:center; justify-content:flex-end;
               gap:${(h * 0.63).toFixed(1)}px; min-width:0; flex:0 1 auto;">
    <img class="b24-plogo ${kitClass}" src="${lockup}" alt="Bitrix24 Partners">
    ${plated ? `<span class="b24x-plate" data-ink="${ink}" style="${plate}">${mark}</span>` : mark}
  </span>`;
};

const PARTNER_MARK_H = 24;
const PARTNER_MARK_W = 180;

const HEAD_PLATE_PAD_VAR = "--b24-s1";
const HEAD_PLATE_PAD_PX  = 4;
const headPlated = !!partnerLogo && logoInk === "light";
const headMarkH = PARTNER_MARK_H - (headPlated ? 2 * HEAD_PLATE_PAD_PX : 0);
const headMarkW = PARTNER_MARK_W - (headPlated ? 2 * HEAD_PLATE_PAD_PX : 0);
const headMark = partnerLogo
  ? `<img src="${esc(partnerLogo)}" alt="${esc(partnerName)}"
        style="max-height:${headMarkH}px; max-width:${headMarkW}px;
               height:auto; width:auto; object-fit:contain; display:block; flex:0 0 auto;">`
  : "";

const runhead = title => `
  <div class="b24-runhead">
    <span style="display:inline-flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto;">
      ${headPlated
        ? `<span class="b24x-plate" data-ink="light" data-where="runhead"
                 style="${plateStyle("light", HEAD_PLATE_PAD_VAR, false)}">${headMark}</span>`
        : headMark}
      <span style="font-weight:700; color:var(--b24-text); white-space:nowrap;
                   overflow:hidden; text-overflow:ellipsis;">${esc(partnerName)}</span>
    </span>
    <span style="flex:0 0 auto; padding-left:var(--b24-s4);
                 text-align:right; white-space:nowrap;">${esc(title)}</span>
  </div>`;
const footer = () => `
  <div class="b24-footer">
    <img class="b24-plogo b24-plogo--foot" src="${assets.lockupDark}" alt="Bitrix24 Partners">
    <span>${esc(partnerName)}${PT.email ? " · " + esc(PT.email) : ""} · Page <span class="b24-pageno"></span></span>
    ${P.effectiveFrom ? `<span class="b24x-foot-prices">Prices as of ${esc(P.effectiveFrom)}</span>` : ""}
  </div>`;

const cover = () => `
<section class="page page--partner-navy page--flush" style="padding:var(--b24-page-pad);">
  <div class="b24-tetris" style="position:absolute; right:-50px; top:-50px; opacity:.55;"></div>
  <div class="b24-tetris--light b24-tetris b24-tetris--notch-bl" style="position:absolute; left:-55px; bottom:-55px; opacity:.15;"></div>
  <span class="b24-star" style="position:absolute; right:150px; top:150px; width:56px; height:56px;"></span>

  <div class="b24-plogo b24-plogo--cover" style="z-index:1;">
    ${cobrand(assets.lockupWhite, "b24-plogo--cover", 30, 150, {onDark:true, padVar:"--b24-s3"})}
  </div>

  <div class="b24-content-z" style="margin-top:auto; margin-bottom:40px;">
    <span class="b24-pill" style="margin-bottom:22px;">Value assessment</span>
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

const headline = () => {
  const num = i => ` <span style="font-size:.6em;font-weight:600">(${i}/3)</span>`;
  const first = `
<section class="page page--sky">
  ${runhead("Summary")}
  <h1 class="b24-h1">The numbers${num(1)}</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>What</th><th>Month</th><th>Year</th></tr></thead>
      <tbody>
        <tr><td>Payroll saving${

              R ? ` (${esc(R.case)}, ${int(R.pct)}% of named time)` : ""}</td><td>${money(T.fotMonth)}</td><td>${money(T.fotYear)}</td></tr>
        ${

          CAP ? `<tr><td>Working hours freed<span class="b24x-td-sub">${fte1(CAP.fte)} full-time equivalents</span></td><td>${hours(CAP.hoursMonth)}</td><td>${hours(CAP.hoursYear)}</td></tr>
        <tr><td>Cash effect<span class="b24x-td-sub">while the team stays the same size</span></td><td>${DASH}</td><td>${DASH}</td></tr>` : ""}
        ${S.showRevenue && T.revMonth > 0 ? `<tr><td>Additional: revenue uplift (estimate)</td><td>${money(T.revMonth)}</td><td>${money(T.revMonth * 12)}</td></tr>` : ""}
        ${S.showRevenue && T.potMonth > 0 ? `<tr><td>Additional: existing-base potential (estimate)</td><td>${money(T.potMonth)}</td><td>${money(T.potMonth * 12)}</td></tr>` : ""}
      </tbody>
    </table>
  </div>

  <div class="b24-dashed" style="margin-top:var(--b24-s5)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      <span class="b24-strong">What this figure means.</span> It is the cost of the working time now spent on these tasks. It is not profit, and not cash freed up. The hours are the same time counted in a unit the client can check against their own records.
    </p>
  </div>
  ${footer()}
</section>`;

  const second = `
<section class="page page--sky">
  ${runhead("Summary")}
  <h1 class="b24-h1">First-year cost${num(2)}</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>First year</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>${esc(P.to)} subscription, year</td><td>− ${money(T.subscriptionYear)}</td></tr>
        <tr><td>Implementation services, one-off${T.serviceUnquoted
              ? ` — quoted for ${int(T.serviceQuoted)} of ${int(S.items.length)} scenarios`
              : ""}</td><td>− ${money(T.serviceSum)}</td></tr>
        <tr><td><strong>Total first-year cost</strong></td><td><strong>− ${money(T.firstYearCost)}</strong></td></tr>
        <tr><td><strong>Net first-year payroll saving</strong></td><td><strong>${money(T.netFirstYear)}</strong></td></tr>
        ${

          !CAP ? ""
          : CAP.paybackBlocked === "unquoted"
            ? `<tr><td>Payback</td><td>not yet — ${int(CAP.unquoted)} scenario(s) have no fee</td></tr>`
          : CAP.paybackBlocked ? ""
          : `<tr><td><strong>Payback</strong></td><td><strong>${
              CAP.paybackMonths < 2
                ? `${new Intl.NumberFormat(LOC,{maximumFractionDigits:1}).format(Math.round(CAP.paybackMonths*(52/12)*10)/10)} weeks`
                : `${new Intl.NumberFormat(LOC,{maximumFractionDigits:1}).format(Math.round(CAP.paybackMonths*10)/10)} months`
            }</strong></td></tr>`}
      </tbody>
    </table>
  </div>
  ${T.serviceUnquoted ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    ${int(T.serviceUnquoted)} scenario(s) are not priced yet, so the figure above is not the full implementation cost, and the payback cannot be worked out from it.</p>` : ""}
  <p class="b24-small" style="margin-top:var(--b24-s3)">
    Vibe+ is the variant of a Bitrix24 plan that includes the AI features; Essential is the same plan without them, for the same number of users.</p>
  ${footer()}
</section>`;

  const third = `
<section class="page page--sky">
  ${runhead("Summary")}
  <h1 class="b24-h1">How to read these numbers${num(3)}</h1>
  ${overlapBlock()}
  ${revenueBlock()}

  <div class="b24-quote">
    ${

      ""}Payroll saving is the sum of the selected scenarios over twelve months. A month here is
    ${int(S.economics.daysMonth)} working days, which is ${int(S.economics.contractHours)} paid
    hours, and one hour costs the gross salary plus a
    ${int(S.economics.burdenPct)}% employer payroll burden, divided by those hours.
    ${S.showRevenue ? "Revenue figures are projections and are shown separately. They never enter the net saving." : "This report leaves revenue projections out."}
    ${

      R && R.text ? esc(R.text) : ""}
    ${

      CAP && CAP.sensitivityText ? esc(CAP.sensitivityText) : ""}
    ${CAP && CAP.cashNote ? `<span class="b24-strong">Cash effect.</span> ${esc(CAP.cashNote)}` : ""}
  </div>
  ${footer()}
</section>`;
  return [first, second, third];
};


const revenueBlock = () => {
  const g = S.revGuard;
  if (!g || g.ok || !g.text) return "";
  return `
  <div class="b24-dashed" style="margin-top:var(--b24-s5); border-color:#A15C00;">
    <p class="b24-p" style="margin:0; font-size:13.5px; color:#A15C00;">
      <span class="b24-strong" style="color:#A15C00;">Revenue above the credibility limit.</span>
      ${esc(g.text)}
    </p>
  </div>`;
};

const overlapBlock = () => {
  const o = S.overlap;
  if (!o || o.ok) return "";
  const src = o.source ? ` ${esc(o.source)}` : "";
  if (o.level === "soft") return `
  <div class="b24-dashed" style="margin-top:var(--b24-s5)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      <span class="b24-strong">Above the usual range.</span>
      ${o.noteText ? esc(o.noteText) : ""}${src}
    </p>
  </div>`;
  return `
  <div class="b24-dashed" style="margin-top:var(--b24-s5); border-color:#A15C00;">
    <p class="b24-p" style="margin:0; font-size:13.5px; color:#A15C00;">
      <span class="b24-strong" style="color:#A15C00;">Estimate above the credibility limit.</span>
      The selected scenarios come to ${pct1(o.pct)}% of the company's monthly payroll cost (${money(o.payrollMonth)}). That is above the ${int(o.threshold)}% limit this model treats as credible. The scenarios most likely overlap, so the same working hours are counted more than once. Please check the coverage shares before you rely on these figures.${src}
    </p>
  </div>`;
};

const scenarioPages = () => chunk(S.items, ROWS_PER_PAGE).map((rows, i, all) => `
<section class="page page--sky">
  ${runhead("Selected scenarios")}
  <h1 class="b24-h1">Selected scenarios${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>

  <div class="b24-table-wrap">
    <table class="b24-table${wideTable ? " b24x-table--wide" : ""}">
      <thead><tr><th>Scenario</th><th>Who</th><th>Coverage</th><th>Saving / month</th><th>Saving / year</th>${
        showRev ? `<th>Revenue / month<span class="b24x-th-sub">estimate</span></th>` : ""}</tr></thead>
      <tbody>
        ${rows.map(it => `<tr>
          <td>${esc(it.title)}${isGated(it) ? `<sup class="b24x-gate-mark">${GATE_MARK}</sup>` : ""}${segCount(it) > 1
              ? `<span class="b24x-td-sub">${int(segCount(it))} segments</span>` : ""}</td>
          <td>${esc(it.role)}</td>
          <td>${it.coverage === null ? "n/a" : int(it.coverage) + "%"}</td>
          <td>${noFot(it) ? DASH : money(it.fotMonth)}</td>
          <td>${noFot(it) ? DASH : money(it.fotYear)}</td>
          ${showRev ? `<td class="b24x-est">${noRev(it) ? DASH : money(it.rev)}</td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  ${rows.some(noFot) ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    ${DASH} in the saving columns: the scenario works on revenue, not on the payroll fund,
    so it has no payroll saving to show.</p>` : ""}
  ${rows.some(isGated) ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    ${GATE_MARK} ${esc(gate.rowNote)}</p>` : ""}
  ${showRev ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    Revenue / month is a projection, not a saving the client can verify. It never enters the net first-year figure${rows.some(noRev) ? `; ${DASH} means the scenario has no revenue effect` : ""}.
    The first page shows the same amount split into revenue uplift and existing-base potential.</p>` : ""}
  ${footer()}
</section>`);

const CLIENT_MARK = '<sup class="b24x-gate-mark">\u2022</sup>';
const ASSUM_HALF_BUDGET = 32;
const ASSUM_WRAP_CHARS = 46;
const rowWeight = r => r.t === "field"
  ? (String(r.f.label || "").length > ASSUM_WRAP_CHARS ? 3 : 2)
  : (r.t === "seg" ? 3 : 2);
const ASSUM_ROWS_PER_PAGE = ASSUM_HALF_BUDGET;
const ASSUM_SHARED_WEIGHT = 18;
const assumWeight = it => 1 + (it.fields || []).length
  + (it.segments || []).reduce((a, fs) => a + 1 + fs.length, 0);

const originCell = o => o ? `<span class="b24x-td-sub" style="display:inline; text-transform:none; letter-spacing:0;">${esc(o)}</span>` : "";

const assumptionPages = () => {
  const shared = (S.assumptions || []).length ? `
  <div class="b24-table-wrap">
    <table class="b24-table b24x-table--assum">
      <thead><tr><th>Across the whole calculation</th><th>Value</th><th>Where it comes from</th></tr></thead>
      <tbody>
        ${S.assumptions.map(a => `<tr><td>${esc(a.label)}</td><td>${esc(a.value)}</td><td>${originCell(a.origin)}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>` : "";

  const rows = [];
  (S.items || []).forEach(it => {
    const segs = it.segments || [];
    rows.push({t: "head", it});
    it.fields.forEach(f => rows.push({t: "field", it, f, seg: segs.length ? 1 : null}));
    segs.forEach((fs, k) => {
      rows.push({t: "seg", it, n: k + 2});
      fs.forEach(f => rows.push({t: "field", it, f, seg: k + 2}));
    });
  });

  const pages = [];
  let cur = [], load = 0;
  let budget = ASSUM_HALF_BUDGET - (shared ? ASSUM_SHARED_WEIGHT : 0);
  for (const r of rows) {
    const w = rowWeight(r);
    if (cur.length && load + w > budget) {
      const carry = [];
      while (cur.length && cur[cur.length - 1].t !== "field") carry.unshift(cur.pop());
      pages.push(cur);
      cur = carry; load = carry.reduce((a, x) => a + rowWeight(x), 0);
      budget = ASSUM_HALF_BUDGET;
    }
    cur.push(r); load += w;
  }
  if (cur.length) pages.push(cur);

  const cell = r => {
    if (r.t === "head" || r.t === "cont") {
      const segs = r.it.segments || [];
      return `<tr><td colspan="3" style="background:var(--b24-card);">
        <span class="b24-strong">${esc(r.it.title)}</span>${r.t === "cont"
          ? ' <span style="font-weight:600;">(continued)</span>'
          : segs.length ? ` <span style="font-weight:600;">(${int(segs.length + 1)} value sets)</span>` : ""}</td></tr>`;
    }
    if (r.t === "seg") return `<tr><td colspan="3" style="padding-top:8px;">
        <span class="b24-strong">Segment ${int(r.n)}</span></td></tr>`;
    return `<tr>
        <td>${esc(r.f.label)}${r.f.client ? CLIENT_MARK : ""}</td>
        <td><span class="b24-strong">${esc(r.f.value)}</span></td>
        <td>${originCell(r.f.origin)}</td></tr>`;
  };

  return pages.map((group, i, all) => {
    const body = (group[0] && group[0].t === "field"
      ? [{t: "cont", it: group[0].it}].concat(group[0].seg && group[0].seg > 1
          ? [{t: "seg", it: group[0].it, n: group[0].seg}] : [])
      : []).concat(group);
    return `
<section class="page page--sky">
  ${runhead("What we assumed")}
  <h1 class="b24-h1">What we assumed${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>
  ${i === 0 ? shared : ""}
  <div class="b24-table-wrap"${i === 0 && shared ? ' style="margin-top:var(--b24-s5)"' : ""}>
    <table class="b24-table b24x-table--assum">
      <thead><tr><th>What we used</th><th>Value</th><th>Where it comes from</th></tr></thead>
      <tbody>
        ${body.map(cell).join("")}
      </tbody>
    </table>
  </div>
  ${

    i === all.length - 1 && S.orgLegend ? `<p class="b24-small" style="margin-top:var(--b24-s3)">
    ${esc(S.orgLegend)}</p>` : ""}
  ${footer()}
</section>`;
  });
};

const aiLine = () => {
  const one = typeof S.aiForPlan === "string" && S.aiForPlan.trim() ? S.aiForPlan.trim() : null;
  if (one) return `<li class="is-yes">${esc(one)}</li>`;
  return (S.aiAllowance || []).map(a => `<li class="is-yes">${esc(a)}</li>`).join("");
};

const planPage = () => {
  const num = i => ` <span style="font-size:.6em;font-weight:600">(${i}/2)</span>`;
  const first = `
<section class="page page--sky">
  ${runhead("Recommended plan")}
  <h1 class="b24-h1">Recommended plan${num(1)}</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th></th><th>Plan</th><th>Per month for the whole account, billed annually</th></tr></thead>
      <tbody>
        <tr><td>Currently</td><td>${esc(P.from)}</td><td>${money(P.fromAnnualPerMonth)}</td></tr>
        <tr><td>Recommended</td><td><strong>${esc(P.to)}</strong></td><td><strong>${money(P.toAnnualPerMonth)}</strong></td></tr>
        ${P.diffPerMonth == null ? "" : (() => {
          const d = P.diffPerMonth;
          const kind = P.fromKind === "none" ? "new spend" : (d < 0 ? "downgrade" : d === 0 ? "same price" : "upgrade");
          const sign = d === 0 ? "" : (d > 0 ? "+ " : "\u2212 ");
          return `<tr><td>Difference</td><td>${kind}</td>
               <td><strong>${sign}${money(Math.abs(d))}</strong></td></tr>
        <tr><td>Difference, year</td><td></td><td>${sign}${money(Math.abs(d) * 12)}</td></tr>`;
        })()}
      </tbody>
    </table>
  </div>
  ${gated.length ? `
  <div class="b24-dashed" style="margin-top:var(--b24-s6); border-color:#A15C00;">
    <p class="b24-p" style="margin:0; font-size:13.5px; color:#A15C00;">
      <span class="b24-strong" style="color:#A15C00;">${gated.length === 1 ? "One of these scenarios needs a higher plan." : `${int(gated.length)} of these scenarios need a higher plan.`}</span>
      They are listed from ${esc(gate.minPlan)} up, so they are not available on ${esc(P.to)}:
      ${gate.titles.map(x => esc(x)).join(", ")}.
      ${gate.fotYear > 0
          ? `${money(gate.fotYear)} of the payroll saving a year comes from them.`
          : `They add nothing to the payroll saving on their own — they work on revenue.`}
      Two honest ways forward: move to ${esc(gate.minPlan)}, or start with the
      other scenarios and add these in a second step once the plan allows it.
    </p>
  </div>` : ""}

  <p class="b24-p">Plan prices are for the whole account, not per user. The number in an Enterprise tier (250, 500, 1000 …) is the seat limit the plan includes, and the price already covers it. Nothing above is multiplied by headcount.</p>

  ${footer()}
</section>`;
  return [first, `
<section class="page page--sky">
  ${runhead("Recommended plan")}
  <h1 class="b24-h1">What ${esc(P.to)} adds${num(2)}</h1>
  <ul class="b24-checklist">
    ${aiLine()}
    ${(Array.isArray(S.planDelta) && S.planDelta.length
        ? S.planDelta
        : ["Vibecode platform", "MCP server — connect external AI systems to your Bitrix24",
           "Unlimited REST API and Bitrix24 Market"]
      ).map(x => `<li class="is-yes">${esc(x)}</li>`).join("\n    ")}
  </ul>

  <div class="b24-dashed" style="margin-top:var(--b24-s6)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      AI is set by plan, not by a request count. No per-request quotas are published, so no numeric AI limits are quoted here.
      ${P.lineupFrom
        ? `Prices are taken from the Bitrix24 price list of ${esc(P.effectiveFrom)}. The new plan lineup applies from ${esc(P.lineupFrom)}: a plan bought or renewed before that date keeps its previous terms until the end of the paid period or ${esc(P.grandfatheredUntil)}, whichever is later.`
        : `Prices are taken from the Bitrix24 price list of ${esc(P.effectiveFrom)}. Existing clients keep their current pricing until the end of their period or ${esc(P.grandfatheredUntil)}, whichever is later.`}
    </p>
  </div>

  ${footer()}
</section>`];
};


const PROPOSAL_ROWS_LAST = 4;
const PROPOSAL_ROWS_FIRST = 12;
const proposal = () => {
  const items = S.items || [];
  const unpriced = T.serviceUnquoted || 0;
  const start = (PT.startDate || "").trim();
  const note = (PT.scopeNote || "").trim();
  const firstYear = (T.serviceSum || 0) + (T.subscriptionYear || 0);
  const oneSheet = items.length <= PROPOSAL_ROWS_LAST;
  const scopeChunks = oneSheet ? [items] : (() => {
    const out = []; let cur = [];
    for (const it of items) {
      if (cur.length >= PROPOSAL_ROWS_FIRST) { out.push(cur); cur = []; }
      cur.push(it);
    }
    if (cur.length) out.push(cur);
    return out;
  })();
  const total = scopeChunks.length + (oneSheet ? 0 : 1);
  const intro = `<p class="b24-p" style="margin:0 0 var(--b24-s5); font-size:13.5px;">
    Prepared from the calculation in this document. The scope below is the list of scenarios
    you picked; the wording of the work itself and the start date come from
    ${esc(PT.person || partnerName)}.
  </p>`;
  const scopeTable = (rows, i, all) => `
  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th>What phase 1 covers${all > 1 ? ` (${i + 1}/${all})` : ""}</th><th>Who it is for</th></tr></thead>
      <tbody>
        ${rows.map(it => `<tr><td>${esc(it.title)}${isGated(it) ? `<sup class="b24x-gate-mark">${GATE_MARK}</sup>` : ""}</td><td>${esc(it.role)}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>`;
  const head = i => `
  ${runhead("Phase 1")}
  <h1 class="b24-h1">Phase 1 — what we propose${total > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${total})</span>` : ""}</h1>`;
  const priceBlock = `
  <div class="b24-table-wrap"${oneSheet ? ' style="margin-top:var(--b24-s5)"' : ""}>
    <table class="b24-table">
      <thead><tr><th>What it costs</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>Implementation of the scenarios above, one-off</td><td>${money(T.serviceSum)}</td></tr>
        <tr><td>${esc(P.to)} subscription, first year</td><td>${money(T.subscriptionYear)}</td></tr>
        <tr><td><strong>First-year commitment</strong></td><td><strong>${money(firstYear)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  ${unpriced ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    ${int(unpriced)} of the scenarios above are not priced yet, so the implementation figure is not final.</p>` : ""}

  <div class="b24-dashed" style="margin-top:var(--b24-s5)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      <span class="b24-strong">Phase 1 can start:</span> ${start ? esc(start) : "to be agreed"}.
      ${note ? "" : "The scope of work is agreed in the first working session."}
    </p>
  </div>
  ${note ? `<div class="b24-quote" style="margin-top:var(--b24-s4)">${esc(note)}</div>` : ""}`;

  const scopeSheets = scopeChunks.map((rows, i) => `
<section class="page page--sky">
  ${head(i)}
  ${i === 0 ? intro : ""}
  ${scopeTable(rows, i, scopeChunks.length)}
  ${oneSheet ? priceBlock : ""}
  ${footer()}
</section>`);
  if (oneSheet) return scopeSheets;
  return scopeSheets.concat(`
<section class="page page--sky">
  ${head(total - 1)}
  ${priceBlock}
  ${footer()}
</section>`);
};

const closing = () => `
<section class="page page--partner-navy" style="text-align:center; align-items:center; justify-content:center;">
  <div class="b24-tetris" style="position:absolute; left:-50px; top:-50px; opacity:.5;"></div>
  <div class="b24-tetris--light b24-tetris b24-tetris--notch-tr" style="position:absolute; right:-55px; bottom:-55px; opacity:.14;"></div>

  <div class="b24-content-z" style="max-width:82%;">
    <h1 class="b24-display" style="font-size:38px;">Let's put this<br>into <span class="b24-hl">practice</span>.</h1>
    <p class="b24-lead" style="margin:22px auto 34px; font-size:17px; opacity:.92;">
      ${money(T.fotYear)} of payroll saving a year, on your own numbers. The next step is a working session on the scenarios you picked.
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
    ${cobrand(assets.lockupWhite, "b24-plogo--foot", 20, 110, {onDark:true, padVar:"--b24-s2"})}
  </div>
</section>`;

const sheets = [
  cover(),
  headline(),
  scenarioPages(),
  assumptionPages(),
  planPage(),
  proposal(),
  closing(),
].flat().filter(Boolean);
const pages = sheets.join("\n");

const html = outboundDoc(`<!DOCTYPE html>
<html lang="${esc(S.lang || "en")}">
<head>
<meta charset="UTF-8">
<title>${esc(clientName || partnerName)} — AI value assessment</title>
${assets.baseHref ? `<base href="${assets.baseHref}">\n` : ""}${assets.styleTags}
<style>
  @media screen { body { padding: 24px 0; } }
  .b24-card--white,.b24-table-wrap{box-shadow:none;border:1px solid var(--b24-line)}

  .page > .b24-table-wrap{flex-shrink:0}

  .b24x-table--wide thead th{padding:12px 9px; font-size:13px}
  .b24x-table--wide tbody td{padding:11px 9px; font-size:12px}
  .b24x-table--wide tbody td:first-child{font-size:13px; line-height:1.25}
  .b24x-th-sub{display:block; font-family:var(--b24-font-body); font-weight:600;
               font-size:10.5px; letter-spacing:.02em; opacity:.85; margin-top:2px}
  .b24x-td-sub{display:block; font-family:var(--b24-font-body); font-weight:600;
               font-size:10.5px; color:var(--b24-text-mute); text-transform:none;
               margin-top:3px}

  .b24-footer{align-items:flex-end}
  .b24x-foot-prices{display:block; font-family:var(--b24-font-body); font-weight:600;
                    font-size:9.5px; color:var(--b24-text-mute); margin-top:2px;
                    text-align:right}

  @media print {
    .page { break-inside: avoid; page-break-inside: avoid; }
    h1, .b24-h1, .b24-display, .b24-label, thead, thead tr, thead th {
      break-after: avoid; page-break-after: avoid;
      break-inside: avoid; page-break-inside: avoid;
    }
    tr, .b24-table-wrap, .b24-card, .b24-dashed, .b24-quote {
      break-inside: avoid; page-break-inside: avoid;
    }
  }

  .b24x-table--assum tbody td:nth-child(3),
  .b24x-table--assum thead th:nth-child(3){width:1%; white-space:nowrap}
  .b24x-table--assum tbody td{padding:9px 12px; font-size:12.5px}
  .b24x-table--assum thead th{padding:11px 12px; font-size:13px}
  .b24-table tbody td.b24x-est{color:var(--b24-text-mute)}
  .b24x-gate-mark{color:#A15C00; font-weight:700; font-size:.8em; padding-left:1px}
</style>
</head>
<body>
${pages}
</body>
</html>
`);

  const pageCount = sheets.length;
  const hits = auditClient(html, P, money,
    {items: S.items || [], serviceSum: (S.totals || {}).serviceSum || 0});
  const blocked = (S.invalid || []).map(x =>
    `scenario "${x.title}" has an input error and was left out of every total`)
    .concat((S.inputErrors || []).map(x =>
      `"${x.label}" in the company details is not a usable figure: ${x.text}`));
  const missing = requiredDisclosures(html, gate, gated, GATE_MARK, money, {
    required: disclosureRequired, planCarriesAgents,
    ids: AGENT_SCENARIO_IDS, items: S.items || [],
  });
  return {html, pageCount, hits, missing, blocked};
}

function outboundDoc(doc) {
  return doc
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
             (m, open, css, close) => open + css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n[ \t]*(?=\n)/g, "") + close)
    .replace(/[ \t]*<!--[\s\S]*?-->/g, "");
}

function sourceFindings(doc) {
  const out = [];
  if (/<!--/.test(doc)) out.push("an HTML comment in the document source");
  for (const m of doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/\/\*/.test(m[1])) { out.push("a CSS comment in the document styles"); break; }
  }
  for (const m of doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/[\u0400-\u04FF]/.test(m[1])) { out.push("Cyrillic text in the document styles"); break; }
  }
  return out;
}

function visibleText(doc) {
  return doc
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[a-z][^>]*>/gi, m => m.replace(/\s+[a-z-]+\s*=\s*("[^"]*"|'[^']*')/gi, ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}


function requiredDisclosures(doc, gate, gated, mark, money, own) {
  const out = [];
  if (gate && gate.planHasAgents !== own.planCarriesAgents)
    out.push(`the plan lists disagree: the calculator says agents ${gate.planHasAgents ? "ARE" : "are NOT"} ` +
             `available on this plan, the report says they ${own.planCarriesAgents ? "ARE" : "are NOT"}`);
  const flag = (own.items || []).some(it => "needsPlan" in it) ? "needsPlan" : "needsAgent";
  const marked = (own.items || []).filter(it => it[flag] === true).map(it => it.id);
  if (marked.length || (own.items || []).some(it => flag in it)) {
    const mine = (own.items || []).filter(it => own.ids.has(it.id)).map(it => it.id);
    if (marked.slice().sort().join(",") !== mine.slice().sort().join(","))
      out.push(`the scenario lists disagree: the calculator marks [${marked}] as needing a higher plan, ` +
               `the report knows [${mine}]`);
  }

  if (!own.required && !gated.length) return out;

  if (own.required && !gated.length)
    return out.concat("the calculation was saved before the AI-agent check and cannot say which " +
                      "scenarios need an agent, or how much of the saving depends on them — " +
                      "re-export it from the calculator");

  const flat = x => String(x).replace(/\s+/g, " ");
  const hay = flat(visibleText(doc));
  const marks = hay.split(mark).length - 1;
  if (marks < gated.length + 1)
    out.push(`the ${mark} marker next to every scenario that needs an AI agent ` +
             `(found ${marks}, expected at least ${gated.length + 1}: one per row plus the footnote)`);
  if (!hay.includes(flat(`${mark} ${gate.rowNote}`)))
    out.push(`the footnote under the scenario table explaining the ${mark} marker`);
  if (!hay.includes(gate.minPlan))
    out.push(`the name of the plan that includes agents (${gate.minPlan})`);
  const figure = flat(money(gate.fotYear));
  if (!hay.includes(figure))
    out.push(`the amount of saving that depends on agents (${figure})`);
  const lost = (gate.titles || []).filter(x => !hay.includes(flat(x)));
  if (lost.length) out.push(`the names of the affected scenarios (${lost.join("; ")})`);
  return out;
}

function auditClient(doc, P, money, own) {
  const hay = visibleText(doc).toLowerCase();
  const banned = [
    ["itemised partner fees",   /my services/],
    ["unpriced-scenario marker",/not quoted/],
    ["partner copy marking",    /partner copy/],
    ["internal-use marking",    /internal use only/],
  ];
  const hits = banned.filter(([, re]) => re.test(hay)).map(([label]) => label)
    .concat(sourceFindings(doc));

  if (own && own.items) {
    const rows = String(doc).match(/<tr[\s\S]*?<\/tr>/g) || [];
    const cells = r => visibleText(r).replace(/\s+/g, " ").trim();
    own.items.forEach(it => {
      if (typeof it.service !== "number" || it.service <= 0) return;
      const fig = money(it.service).replace(/\s/g, " ");
      const title = String(it.title || "").replace(/\s+/g, " ").trim();
      if (!title) return;
      const leak = rows.some(r => { const c = cells(r); return c.includes(title) && c.includes(fig); });
      if (leak) hits.push(`per-scenario implementation fee ${fig} next to "${title}"`);
    });
  }
  return hits;
}

