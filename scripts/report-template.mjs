/**
 * report-template.mjs — ЕДИНСТВЕННЫЙ ИСТОЧНИК РАЗМЕТКИ ОТЧЁТА.
 *
 * Отсюда её берут ОБА потребителя:
 *   scripts/build-report.mjs — сборка из терминала (data URI, инлайн CSS кита);
 *   index.html               — кнопки «скачать PDF» в браузере (относительные пути).
 * В index.html лежит СГЕНЕРИРОВАННАЯ копия этого файла между маркерами
 * REPORT TEMPLATE — её ставит scripts/embed-report.mjs, а расхождение ловит
 * scripts/check-report-drift.mjs. Руками копию не править: она перезапишется.
 *
 * Почему копия, а не import: index.html обязан оставаться самодостаточным и
 * работать из file://, где загрузка ES-модулей запрещена браузером. Поэтому
 * авторский источник один, а копия — генерируемый артефакт, как встроенный
 * PRICING против config/pricing.json.
 *
 * ОКРУЖЕНИЕ приходит параметром `assets`, чтобы в шаблоне не было ни fs, ни fetch:
 *   lockupDark / lockupWhite — адрес локапа (data URI в Node, относительный путь в браузере);
 *   styleTags                — готовые <style>/<link> для <head>;
 *   baseHref                 — необязательный <base>, чтобы относительные пути
 *                              разрешались от каталога страницы в iframe.
 */

export function buildReport(S, {assets}) {
  /* ОДНА СБОРКА. Раньше их было две — клиентская и партнёрская, и партнёрская
     несла разрыв Essentials-vs-Vibe+, промо-механику, постатейные цены услуг и
     страницу с пометкой о внутреннем использовании. Решение заказчика: отчёт нужен только
     клиентский — партнёр работает с экраном, а клиенту отдаёт один документ.
     Поэтому у buildReport() больше нет режима, и допустимой сборки для
     внутренних данных не осталось: аудит ниже применяется ВСЕГДА.
     На экране при этом ничего не убрано — шаг с ценами услуг, Partner summary,
     разрыв и промо остаются, просто не печатаются. */
  const ROWS_PER_PAGE = 7;          // scenario rows per A4 sheet — deliberately conservative
  const FIELD_ROWS_PER_PAGE = 5;    // строк-наборов значений на A4: сценарий без сегментов весит 1, с сегментами — 1 + их число

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
  /* СЦЕНАРИИ С ЭФФЕКТОМ НА ВЫРУЧКУ, А НЕ НА ФОТ.
     У них экономии ФОТ нет вообще, и «$0» в колонке экономии читается как
     «сценарий ничего не даёт», хотя данные введены и посчитаны. На экране в шаге 4
     там прочерк (paintServices в index.html) — здесь то же самое.
     Признак — hasFot из состояния, то есть состав effect, а НЕ равенство нулю:
     сценарий с эффектом на ФОТ и нулём на входных данных обязан печатать $0.
     Сравнение именно с false: у файлов, сохранённых до появления признака, его
     нет вовсе, и они должны печататься по-старому, а не уйти в сплошной прочерк. */
  const noFot = it => it.hasFot === false;
  const DASH = "\u2014";
  /* КОЛОНКА ВЫРУЧКИ В ТАБЛИЦЕ СЦЕНАРИЕВ.
     Показывается ТОЛЬКО при включённом переключателе. При выключенном девять
     сценариев из одиннадцати дали бы прочерк, а таблица стала бы на колонку шире
     без всякой пользы — и это же причина, по которой прирост выручки не едет в
     таблицу постоянно.
     Значение берётся из items[].rev — это уже посчитанная моделью месячная
     величина по сценарию (computeModel -> computeScenario, сумма по базовому
     набору и всем сегментам). Здесь ничего не складывается и не выводится
     заново: сумма колонки равна revMonth + potMonth с первой страницы.
     Признак прочерка — hasRev, то есть состав effect, а не равенство нулю:
     сценарий с эффектом на выручку и нулём на входных данных обязан печатать $0.
     Сравнение с false — чтобы состояния, снятые до появления признака, вели себя
     по-старому. */
  const showRev = !!S.showRevenue;
  const noRev = it => it.hasRev === false;
  /* ШИРИНА НА A4. Отбивка кита (18px по горизонтали, кегль 15-16px) рассчитана на
     пять колонок: при пяти таблица встаёт в 656px против 658px полосы набора.
     Больше пяти — и таблица перестаёт влезать. Замерено на всех одиннадцати
     сценариях: партнёрская сборка БЕЗ выручки (шесть колонок) даёт на второй
     странице таблицы 672px против 658px, и лишние 14px не выезжают на поля, а
     ОБРЕЗАЮТСЯ: у .b24-table-wrap в ките overflow:hidden. Это было и до колонки
     выручки — от состава заголовков зависит min-content, а он на второй странице
     другой. Поэтому режим тесной вёрстки включается по числу колонок, а не по
     наличию выручки: 5 (клиент без выручки) — как в ките, 6 и 7 — тесно.
     Замер после правки: 656px во всех сочетаниях. */
  const wideTable = showRev;
  /* Базовый набор значений — это сегмент 1, поэтому их всегда на один больше,
     чем в items[].segments. Пометку ставим только когда сегмент не один: она
     нужна, чтобы сумма в строке не читалась как одно значение. Разбивки в
     таблице нет намеренно — входные данные каждого сегмента уже напечатаны на
     странице «The numbers we entered». */
  const segCount = it => 1 + (it.segments || []).length;
  /* Как chunk, но набирает страницу по ВЕСУ элемента, а не по их числу.
     Нужно странице «The numbers we entered»: блок сценария с сегментами занимает
     не одну строку, а одну на каждый набор значений, и пять таких блоков на A4
     уже не помещаются. Вес = 1 + число сегментов. Один элемент кладётся на
     страницу всегда, даже если он тяжелее лимита, — иначе цикл не сдвинется.
     Без сегментов вес каждого равен 1 и разбиение совпадает с chunk(arr, n). */
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

/* THE PLAN PAIR arrives exactly as the partner picked it: current and target are
   chosen independently on screen. The "before" price now has TWO states, not three:
   a real price, or nothing because the client has no Bitrix24 yet — and that zero is
   a known price, not missing data. The third state, "no published price", is gone:
   Essentials used to stop at the 2,000-user tier, and the official export from Anton
   covers all fifteen. So a difference is printed for every pair, and fromPriceCell()
   has nothing left to branch on. */
const partnerName = PT.company || "Bitrix24 Partner";
const clientName = S.company?.name || "";

/* ---------- CO-BRANDING ----------------------------------------------------
   Used by the COVER and the CLOSING page only. The running header no longer
   co-brands: it belongs to the partner alone, and the Bitrix24 lockup lives in
   the footer of every page (see runhead() / footer()). Co-branding stays where
   the composition is built for it — one deliberate pairing at the front of the
   document and one at the back, instead of a second lockup on every sheet.
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
/* Светлота знака разбирается ОДИН раз: плашка нужна и на тёмных полотнах
   (обложка, закрывающая), и в верхнем колонтитуле светлых страниц. */
const logoInk = PT.logoInk === "light" || PT.logoInk === "dark" ? PT.logoInk : null;

/* ОДИН НАБОР ПРАВИЛ ПЛАШКИ НА ВСЕ МЕСТА. Меняются только два входа — токен
   отбивки и то, тёмное ли под ней полотно; всё остальное общее, поэтому шапка не
   может разъехаться с обложкой по правилам:
     заливка  — по светлоте знака: белая под тёмным и цветным, --b24p-deep-2 под
                светлым (то же, что на navy);
     радиус   — --b24-r-tile, токен кита, свой не вводим;
     отбивка  — токен кита, свой размер на каждое место (плашка на обложке в два
                с лишним раза крупнее той, что влезает в колонтитул);
     рамка    — волосяная rgba(255,255,255,.22) ТОЛЬКО когда и плашка, и полотно
                тёмные: на navy она отделяет одно от другого, а на светлой
                странице тёмная плашка отделена сама собой и рамка была бы
                невидимой линией ради симметрии кода. */
const plateStyle = (ink, padVar, darkPage) =>
    `background:${ink === "light" ? "var(--b24p-deep-2)" : "var(--b24-white)"};`
  + `padding:var(${padVar}); border-radius:var(--b24-r-tile);`
  + (ink === "light" && darkPage ? "border:1px solid rgba(255,255,255,.22);" : "")
  + "display:inline-flex; align-items:center; flex:0 0 auto;";

/* ПОДЛОЖКА ПОД ЗНАКОМ ПАРТНЁРА НА ТЁМНЫХ ПОЛОТНАХ.
   У партнёра один файл логотипа, и он же печатается на светлых страницах и на
   тёмно-синей обложке с закрывающей страницей. Тёмный знак на navy пропадает.
   Плашка решает это, не требуя второго файла.
   ОДНА ГЕОМЕТРИЯ, ДВА ЗАЛИВА. Форма, отбивка и радиус у плашки всегда одни и те
   же — меняется только заливка, и меняется по замеру светлоты самого знака
   (partner.logoInk, считается в index.html):
     dark  -> белая плашка   (--b24-white),  контраст с тёмным знаком ~11.7:1;
     light -> тёмная плашка  (--b24p-deep-2 #04213F), с белым знаком ~16.2:1,
              и сама она отличима от полотна: в этом углу градиент около #0A63A6,
              то есть ~2.55:1, плюс волосяная рамка тем же rgba(255,255,255,.22),
              которым кит отбивает колонтитулы на navy;
     null  -> плашки НЕТ. Светлоту измерить не удалось (чужой домен опечатывает
              canvas), а белая плашка под белым знаком спрятала бы знак, который
              до правки был виден. Молчать безопаснее, чем угадывать.
   ФЛАГ ЯВНЫЙ, А НЕ ПО МЕСТУ ВЫЗОВА. onDark передают только обложка и
   закрывающая страница. На светлых страницах плашки нет и быть не может: там
   она читалась бы заплаткой, а верхний колонтитул знак вообще рисует сам, без
   cobrand(). Значение по умолчанию false — если однажды cobrand() позовут со
   светлой страницы, плашка не появится сама собой.
   Отбивка и радиус — токены кита (--b24-s2/--b24-s3, --b24-r-tile), своих чисел
   нет. Охранное поле остаётся 0.63 высоты локапа и отсчитывается теперь до КРАЯ
   плашки, то есть строже, чем от знака до знака.
   Локап не трогается вообще: официальный белый файл, свои пропорции и цвет. */
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

/* ---------- RUNNING HEADER — ПАРТНЁРСКИЙ ------------------------------------
   Верхний колонтитул отдан партнёру: его логотип и название компании. Локап
   Bitrix24 Partners отсюда УБРАН. Он и так стоит в нижнем колонтитуле каждой
   страницы — то есть печатался дважды на лист, — и партнёрский знак 16px рядом с
   ним читался как приложение к нашему, а не как марка автора документа.
   Теперь наверху только партнёр, внизу только мы: два отдельных знака на разных
   краях листа. Общего знака из двух логотипов не собирается ни здесь, ни где-то
   ещё; наш локап не перекрашен и не растянут — он остался официальным файлом в
   своих пропорциях, только переехал из шапки в подвал, где уже был.
   Со-брендирование сохранено там, где оно уместно и задумано композицией:
   обложка и закрывающая страница (см. cobrand()).
   ЛОГОТИПА НЕТ — остаётся одно название, без пустого места и без подстановки
   нашего локапа взамен: пустой img не выводится вообще, а gap во flex не
   возникает, потому что второго ребёнка нет. */
/* Размер партнёрского знака в шапке. Подобран замером, а не на глаз.
   Высоту колонтитула задаёт самый высокий его ребёнок: текст 10.5px даёт строку
   ~16px, наш локап давал ровно 16px, отсюда прежние 28.8px вместе с отбивкой и
   линейкой. Прогон по H = 16/20/24/28/32/40 на обеих сборках, на всех страницах,
   с логотипами пропорций 10:1, 4:1 и 1:1 и с названием компании в 62 символа:

     H     логотип 4:1     шапка     запас до подвала   обрез
     16     64x16          29.0px          20px           0
     20     80x20          33.0px          20px           0
     24     96x24          37.0px          20px           0
     28    112x28          41.0px          20px           0
     32    128x32          45.0px          20px           0
     40    160x40          53.0px          20px           0

   Геометрического обрыва нет: страницы прижимают подвал к низу (margin-top:auto),
   поэтому запас до подвала не меняется вообще, а обреза нет ни на одной высоте.
   Ограничение здесь редакторское, а не техническое: колонтитул должен остаться
   колонтитулом. Взято 24 — знак в 1.5 раза заметнее прежних 16px, шапка 37px,
   то есть всё ещё ниже заголовка страницы (b24-h1); с 32-40px шапка уходит на
   45-53px и начинает читаться как шапка бланка, перетягивая внимание с
   содержимого. Плюс у самых широких знаков (10:1) высота выше 20 не даёт вообще
   ничего: они упираются в MARK_W и остаются 180x18.

   MARK_W = 180 держит широкие логотипы в пределах полосы набора: .page стоит
   overflow:hidden, обрезанный логотип хуже мелкого. 180px — 27% полосы 658px;
   правой ячейке остаётся с запасом на самый длинный заголовок страницы
   («Partner economics — internal»). Замерено: пересечений левого блока с правым
   нет ни в одном из 18 сочетаний, включая 62-символьное название с логотипом
   180px — оба конца страхует text-overflow:ellipsis. */
const PARTNER_MARK_H = 24;
const PARTNER_MARK_W = 180;

/* ПЛАШКА В КОЛОНТИТУЛЕ — ТОЛЬКО ПОД СВЕТЛЫМ ЗНАКОМ.
   Тёмный и цветной знак на светлой странице читаются сами (замерено: тёмный
   #102A43 на --b24-page-cool даёт 14.2:1), и плашка под ними была бы заплаткой.
   Белый знак там бледнеет — 1.1:1, практически ничего, — и колонтитул, который
   теперь целиком принадлежит партнёру, остаётся без марки автора. Заливка,
   радиус и логика те же, что на navy: plateStyle(). Рамки нет — на светлой
   странице тёмная плашка отделена сама собой.
   Светлота неизвестна -> плашки нет, как и на тёмных полотнах.

   ВЫСОТА КОЛОНТИТУЛА НЕ РАСТЁТ, И ЭТО ГЛАВНОЕ ОГРАНИЧЕНИЕ ЗДЕСЬ.
   Высоту шапки задаёт её самый высокий ребёнок. Плашка поверх 24-пиксельного
   знака дала бы 24 + 2x4 = 32px и шапку 45px вместо 37px. Поэтому плашка не
   надстраивается над знаком, а ЗАБИРАЕТ ЕГО ЖЕ 24 пикселя: отбивка 4px с каждой
   стороны, знак внутри 16px. Внешний габарит тот же, полоса набора не двигается.
   Цена честная и сознательная: у светлого знака глиф 16px вместо 24px. Читаемые
   16px стоят больше нечитаемых 24px, и платит эту цену только светлый логотип —
   тёмный и цветной остаются 24px, как были. */
const HEAD_PLATE_PAD_VAR = "--b24-s1";   /* 4px по киту */
const HEAD_PLATE_PAD_PX  = 4;            /* должно совпадать с токеном выше */
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
    <!-- Отступ 10px здесь — между знаком партнёра и его же названием, то есть
         внутри одной марки. Охранное поле локапа Bitrix24 к этой паре не
         относится: локапа в шапке нет вообще, он живёт в подвале. На обложке
         охранное поле как было — 0.63 высоты локапа до края плашки. -->
    <span style="display:inline-flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto;">
      ${headPlated
        ? `<span class="b24x-plate" data-ink="light" data-where="runhead"
                 style="${plateStyle("light", HEAD_PLATE_PAD_VAR, false)}">${headMark}</span>`
        : headMark}
      <span style="font-weight:700; color:var(--b24-text); white-space:nowrap;
                   overflow:hidden; text-overflow:ellipsis;">${esc(partnerName)}</span>
    </span>
    <!-- Заголовок страницы не сжимается: он говорит, где читатель находится, а
         название компании продублировано в подвале и может уступить. Замерено на
         62-символьном названии с логотипом 180px: усекается имя, заголовок цел. -->
    <span style="flex:0 0 auto; padding-left:var(--b24-s4);
                 text-align:right; white-space:nowrap;">${esc(title)}</span>
  </div>`;
const footer = () => `
  <div class="b24-footer">
    <!-- footer keeps the Bitrix24 lockup alone: the partner mark is already in the
         running header on every page, and repeating it twice per sheet reads as
         clutter rather than co-branding. -->
    <img class="b24-plogo b24-plogo--foot" src="${assets.lockupDark}" alt="Bitrix24 Partners">
    <span>${esc(partnerName)}${PT.email ? " · " + esc(PT.email) : ""} · Page <span class="b24-pageno"></span></span>
  </div>`;

/* ---------- page 1: cover ---------- */
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
    ${int(T.serviceUnquoted)} scenario(s) are not priced yet, so the figure above is not the full implementation cost.</p>` : ""}

  ${overlapBlock()}

  <div class="b24-dashed" style="margin-top:var(--b24-s5)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      <span class="b24-strong">What this figure means.</span> It is the cost of the working time now spent on these tasks. It is not profit, and not cash freed up.
    </p>
  </div>

  <div class="b24-quote">
    Payroll saving is the sum of the selected scenarios over twelve months. Scenarios counted
    in days are scaled to ${int(S.economics.daysMonth)} working days. The hourly cost of an
    employee comes from ${int(S.economics.contractHours)} contracted hours a month and a
    ${int(S.economics.burdenPct)}% employer payroll burden.
    ${S.showRevenue ? "Revenue figures are projections and are shown separately. They never enter the net saving." : "This report leaves revenue projections out."}
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
      The selected scenarios come to ${pct1(o.pct)}% of the company's monthly payroll cost (${money(o.payrollMonth)}). That is above the ${int(o.threshold)}% limit this model treats as credible. The scenarios most likely overlap, so the same working hours are counted more than once. Please check the coverage shares before you rely on these figures.
    </p>
  </div>`;
};

/* ---------- scenario overview table, chunked ---------- */
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
          <td>${esc(it.title)}${segCount(it) > 1
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
  ${showRev ? `<p class="b24-small" style="margin-top:var(--b24-s2)">
    Revenue / month is a projection, not a saving the client can verify. It never enters the net first-year figure${rows.some(noRev) ? `; ${DASH} means the scenario has no revenue effect` : ""}.
    The first page shows the same amount split into revenue uplift and existing-base potential.</p>` : ""}
  ${footer()}
</section>`).join("");

/* ---------- inputs used, chunked (transparency: the client can check our numbers) ---------- */
const inputPages = () => chunkByWeight(S.items, FIELD_ROWS_PER_PAGE,
                                       it => 1 + (it.segments || []).length).map((group, i, all) => `
<section class="page page--sky">
  ${runhead("Inputs used")}
  <h1 class="b24-h1">The numbers we entered${all.length > 1 ? ` <span style="font-size:.6em;font-weight:600">(${i + 1}/${all.length})</span>` : ""}</h1>
  ${group.map(it => {
    /* СЕГМЕНТЫ. Сценарий может быть посчитан по нескольким наборам значений:
       базовый плюс добавленные в калькуляторе сегменты. Итог всегда учитывал их
       все, а эта страница печатала только базовый набор — клиенту предлагалось
       сверить сумму по неполным входным данным. Теперь каждый набор идёт своей
       строкой. Пока сегментов нет, страница выглядит ровно как раньше: одна
       строка полей без заголовка «Segment 1». */
    const segs = it.segments || [];
    const line = fs => fs.map(f => `${esc(f.label)}: <span class="b24-strong">${esc(f.value)}</span>`).join(" · ");
    const para = (n, fs) => `
    <p class="b24-p" style="margin:${n === null ? "0" : "6px 0 0"}; font-size:13px;">
      ${n === null ? "" : `<span class="b24-strong">Segment ${n}</span> — `}${line(fs)}
    </p>`;
    return `
  <div class="b24-card b24-card--white" style="margin-bottom:var(--b24-s4); padding:var(--b24-s4) var(--b24-s5);">
    <p class="b24-label" style="margin:0 0 6px;">${esc(it.title)}${
      segs.length ? ` <span style="font-weight:600; text-transform:none;">(${int(segs.length + 1)} segments)</span>` : ""}</p>
    ${para(segs.length ? 1 : null, it.fields)}
    ${segs.map((fs, k) => para(k + 2, fs)).join("")}
  </div>`;
  }).join("")}
  ${footer()}
</section>`).join("");

/* AI-СТУПЕНЬ ВЫБРАННОГО ТАРИФА. Блок называется «What <тариф> adds», значит в нём
   и должно стоять то, что даёт ЭТОТ тариф. Раньше сюда печаталась вся лестница
   (Essentials / Basic Vibe+ / Standard и выше), и при выбранном Professional Vibe+
   клиент читал про два чужих тарифа подряд.
   Строку выбирает состояние (index.html, aiForPlan) — там же, где известен
   целевой тариф. Здесь только запасной путь для файлов, сохранённых до этой
   правки: у них есть массив aiAllowance и нет aiForPlan, и печатать им нечего,
   кроме прежней лестницы — молча потерять содержимое хуже.
   Числовых квот нет ни в одном варианте: их не публикуют. Об этом же говорит
   сноска под блоком. */
const aiLine = () => {
  const one = typeof S.aiForPlan === "string" && S.aiForPlan.trim() ? S.aiForPlan.trim() : null;
  if (one) return `<li class="is-yes">${esc(one)}</li>`;
  return (S.aiAllowance || []).map(a => `<li class="is-yes">${esc(a)}</li>`).join("");
};

/* ---------- plan recommendation (client-safe: names + prices only) ---------- */
const planPage = () => `
<section class="page page--sky">
  ${runhead("Recommended plan")}
  <h1 class="b24-h1">Recommended plan</h1>

  <div class="b24-table-wrap">
    <table class="b24-table">
      <thead><tr><th></th><th>Plan</th><th>Per month for the whole account, billed annually</th></tr></thead>
      <tbody>
        <tr><td>Currently</td><td>${esc(P.from)}</td><td>${money(P.fromAnnualPerMonth)}</td></tr>
        <tr><td>Recommended</td><td><strong>${esc(P.to)}</strong></td><td><strong>${money(P.toAnnualPerMonth)}</strong></td></tr>
        ${P.diffPerMonth == null ? "" : (() => {
          /* Пара может быть понижением: с тирами Essentials до 2000 мест цель может
             стоить меньше текущего тарифа. «+ -$220» — не вариант. */
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
  <p class="b24-p">Plan prices are for the whole account, not per user. The number in an Enterprise tier (250, 500, 1000 …) is the seat limit the plan includes, and the price already covers it. Nothing above is multiplied by headcount.</p>

  <h1 class="b24-h1" style="margin-top:var(--b24-s8); font-size:22px;">What ${esc(P.to)} adds</h1>
  <ul class="b24-checklist">
    ${aiLine()}
    <!-- ОСТАЛЬНЫЕ ТРИ ПУНКТА — СВОЙСТВА ВСЕЙ ЛИНЕЙКИ VIBE+, НЕ ОТДЕЛЬНЫХ ТАРИФОВ.
         config/pricing.json, lineup.vibe_plus: «Adds Vibecode, MCP server, higher
         AI allowance, unlimited REST API + Market» — сказано про линейку целиком.
         vibe_plus_pillars перечисляет Vibecode и MCP тоже без привязки к тарифу, а
         vibe_plus_headline_limits даёт rest_api и bitrix24_market как unlimited без
         разбивки. Различий между тарифами в источнике НЕТ, поэтому эти три пункта
         печатаются для любой цели. Если различия появятся — их место здесь, рядом
         с AI-строкой, которая уже выбирается по тарифу. -->
    <li class="is-yes">Vibecode — build your own AI-powered business apps</li>
    <li class="is-yes">MCP server — connect outside AI agents to Bitrix24</li>
    <li class="is-yes">Unlimited REST API and Bitrix24 Market</li>
  </ul>

  <div class="b24-dashed" style="margin-top:var(--b24-s6)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      AI is set by plan, not by a request count. No per-request quotas are published, so no numeric AI limits are quoted here. Prices apply from ${esc(P.effectiveFrom)}. Existing clients keep their current pricing until the end of their period or ${esc(P.grandfatheredUntil)}, whichever is later.
    </p>
  </div>
  ${footer()}
</section>`;


/* ---------- closing CTA + partner contacts ---------- */
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

/* ---------- assemble ---------- */
const pages = [
  cover(),
  headline(),
  scenarioPages(),
  inputPages(),
  planPage(),
  closing(),
].filter(Boolean).join("\n");

const html = `<!DOCTYPE html>
<html lang="${esc(S.lang || "en")}">
<head>
<meta charset="UTF-8">
<title>${esc(clientName || partnerName)} — AI value assessment</title>
${assets.baseHref ? `<base href="${assets.baseHref}">\n` : ""}${assets.styleTags}
<style>
  @media screen { body { padding: 24px 0; } }
  /* Soft CSS shadows are rasterized as a hard grey rectangle by macOS Preview /
     Quick Look. Replace them with a hairline. render.py injects the same reset,
     this keeps a standalone browser preview honest too. */
  .b24-card--white,.b24-table-wrap{box-shadow:none;border:1px solid var(--b24-line)}

  /* ОБРЕЗАННАЯ ПОСЛЕДНЯЯ СТРОКА ТАБЛИЦЫ. .page — колоночный флексбокс, а
     .b24-table-wrap в ките несёт overflow:hidden. Для флекс-элемента с таблицей
     внутри Chromium берёт flex-basis меньше собственной высоты таблицы, элемент
     ужимается (flex-shrink:1 по умолчанию) — и нижняя строка уезжает под
     скруглённый край. Видно на «The numbers» при трёх строках и на странице
     тарифа: таблица 216px в контейнере 188px. Место на полосе есть, страница
     занята на 764px из 1123 — это не переполнение A4, а именно ужатие.
     Запрещаем сжатие по главной оси. Ширины это не касается: в колоночном
     флексбоксе flex-shrink работает по высоте, поэтому замер ширины таблиц
     (656px против 658px полосы) остаётся прежним. */
  .page > .b24-table-wrap{flex-shrink:0}

  /* ТАБЛИЦА СЦЕНАРИЕВ С КОЛОНКОЙ ВЫРУЧКИ.
     С включённым переключателем колонок становится шесть (клиентский отчёт) или
     семь (партнёрский) вместо пяти и шести. Отбивка кита — 18px по горизонтали и
     кегль 15-16px — рассчитана на пять; на A4 седьмая колонка выдавливала
     название сценария в столбик по одному слову. Здесь тесним ОТБИВКУ и кегль,
     а текст не переносим и не обрезаем: ничего не сокращено, ни одна цифра не
     ужата. Правило живёт в отчёте, а не в brand-ext.css: в документ подключён
     только кит, отчёт обязан быть самодостаточным.
     Своих цветов нет: подписи — --b24-text-mute из кита. */
  .b24x-table--wide thead th{padding:12px 9px; font-size:13px}
  .b24x-table--wide tbody td{padding:11px 9px; font-size:12px}
  .b24x-table--wide tbody td:first-child{font-size:13px; line-height:1.25}
  /* «estimate» под заголовком колонки и «N segments» под названием сценария:
     оценка и проверяемая экономия не должны читаться как величины одного
     качества, поэтому цифры выручки идут приглушённым цветом кита. */
  .b24x-th-sub{display:block; font-family:var(--b24-font-body); font-weight:600;
               font-size:10.5px; letter-spacing:.02em; opacity:.85; margin-top:2px}
  .b24x-td-sub{display:block; font-family:var(--b24-font-body); font-weight:600;
               font-size:10.5px; color:var(--b24-text-mute); text-transform:none;
               margin-top:3px}
  .b24-table tbody td.b24x-est{color:var(--b24-text-mute)}
</style>
</head>
<body>
${pages}
</body>
</html>
`;

  const pageCount = (html.match(/<section class="page/g) || []).length;
  /* Аудит без исключений: сборка одна, и «партнёрской» сборки, где внутреннее
     было бы допустимо, больше нет. */
  const hits = auditClient(html, P, money);
  return {html, pageCount, hits};
}

/* =============================================================================
   АУДИТ ОТЧЁТА — общий для терминала и браузера.
   Сборка одна, и она клиентская: постатейные цены услуг и любая страница,
   помеченная как внутренняя, в документ попасть не должны. Итоговая строка
   внедрения при этом остаётся — она стоит в затратах первого года, без неё
   чистая экономия была бы завышена. Запрещена разбивка, а не сам факт затрат.
   Возвращает находки, а не падает: build-report.mjs отказывается писать файл,
   браузер отказывается печатать. Правило одно, реакция — по месту.
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


function auditClient(doc, P, money) {
  const hay = visibleText(doc).toLowerCase();
  const banned = [
    ["itemised partner fees",   /my services/],
    ["unpriced-scenario marker",/not quoted/],
    ["partner copy marking",    /partner copy/],
    ["internal-use marking",    /internal use only/],
  ];
  const hits = banned.filter(([, re]) => re.test(hay)).map(([label]) => label);

  return hits;
}

