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
  /* ОКРУГЛЕНИЕ ЧЕРЕЗ ЦЕНТЫ, А НЕ СРАЗУ ДО ЦЕЛОГО.
     Сценарий 11 давал ровно $65,487.50 в год, а показывал $65,487. Причина не в
     модели: month * 12 в двоичной арифметике даёт 65487.49999999999, и округление
     до целого честно уводит вниз. Сначала снимаем двоичный мусор — округляем до
     центов, — и только потом до целого. Инвариант «промежуточные не округляем»
     не нарушен: это происходит в форматтере, в момент вывода.
     МИНУС ТИПОГРАФСКИЙ. Intl для отрицательной суммы печатает ASCII-дефис, а все
     строки затрат рядом собираются вручную с U+2212 — в одном блоке выходили два
     разных минуса. Подменяем ведущий дефис на настоящий минус. */
  const toWhole = n => Math.round(Math.round((n || 0) * 100) / 100);
  const fixMinus = str => String(str).replace(/^-/, "\u2212");
  const money = n => fixMinus(new Intl.NumberFormat(LOC, { style: "currency", currency: S.currency, maximumFractionDigits: 0 }).format(toWhole(n)));
  const int = n => new Intl.NumberFormat(LOC).format(toWhole(n));
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
  /* РЕЖИМ РЕАЛИЗАЦИИ. Состояния, снятые до появления переключателя, блока не
     несут — и тогда документ о режиме молчит, а не подставляет «conservative»
     за расчёт, который считался при 100%. Ни одно число здесь не выводится:
     имя режима, доля и готовый текст приходят из состояния. */
  const R = S.realisation || null;
  const realCase = R ? R.case : null;
  /* МОЩНОСТЬ. Состояния, снятые до этой правки, блока не несут — тогда документ
     собирается ровно как раньше, без строк про часы и окупаемость. */
  const CAP = S.capacity || null;
  const hours = n => `${int(n)} h`;
  const fte1 = n => new Intl.NumberFormat(LOC, {minimumFractionDigits:1, maximumFractionDigits:1})
    .format(Math.round((n || 0) * 10) / 10);
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
  /* AI-АГЕНТЫ ПРОТИВ РЕКОМЕНДОВАННОГО ТАРИФА. Расхождение приезжает готовым в
     S.agentGate: состав, доля итога и текст пометки считаются на экране, здесь
     их только печатают — иначе экран и документ разъедутся.
     Старые сохранения блока не несут: тогда gate пуст и отчёт выглядит как
     прежде. Это не «молча пропустить» — у таких файлов признака agent:true не
     было ни у одного сценария, значит и раскрывать было нечего. */
  const gate = S.agentGate || null;
  const gated = gate && !gate.planHasAgents ? (gate.ids || []) : [];
  const gatedIds = new Set(gated);
  const isGated = it => gatedIds.has(it.id);
  /* НАДО ЛИ РАСКРЫВАТЬ — ОТВЕЧАЕМ САМИ, НЕ ТОЛЬКО ПО ГОТОВОМУ БЛОКУ.
     Состояние, снятое до этой правки, agentGate не несёт, и «нет блока» нельзя
     читать как «расхождения нет»: у файла из calc-state-legacy.json выбран
     сценарий 9 на агентах и цель Alaio Standard Vibe+, то есть раскрывать надо,
     а сказать об этом файл не может. Молчащий отчёт тут — худший исход.
     Поэтому обязанность раскрыть определяется по id сценариев и по имени цели:
     и то и другое есть в любом сохранении, включая самые старые. Числа отсюда НЕ
     выводятся — сумма приходит только из agentGate, иначе отчёт начал бы считать
     сам, а этого в проекте нельзя.
     Оба списка — зеркала того, что живёт в index.html (agent:true и
     planHasAgents). Чтобы они не разъехались тихо, ниже стоит сверка: когда
     состояние несёт признаки, расхождение определений роняет сборку. */
  const AGENT_SCENARIO_IDS = new Set([2, 9, 10, 11, 12]);
  const AGENT_PLAN_RE = /^Alaio (?:Professional|Enterprise-\d+) Vibe\+$/;
  const planCarriesAgents = AGENT_PLAN_RE.test(String((S.plan || {}).to || ""));
  const agentItems = (S.items || []).filter(it => AGENT_SCENARIO_IDS.has(it.id));
  const disclosureRequired = !planCarriesAgents && agentItems.length > 0;
  const GATE_MARK = "\u2020";              /* † — не звёздочка: сноска про прочерк
                                              уже занимает знак «—», а звёздочку
                                              читатель ищет у цены */
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
    <!-- ДАТА АКТУАЛЬНОСТИ ЦЕН В ПОДВАЛЕ КАЖДОГО ЛИСТА (P16). Раньше она стояла
         только в прозе на странице тарифа, то есть документ, открытый на любой
         другой странице, не говорил, на какой момент цены верны. Своей строкой, а
         не приписью к первой: имя партнёра бывает 62 символа, и на длинном имени
         одна строка уезжала бы за полосу — замерено check-geometry. -->
    <span>${esc(partnerName)}${PT.email ? " · " + esc(PT.email) : ""} · Page <span class="b24-pageno"></span></span>
    ${P.effectiveFrom ? `<span class="b24x-foot-prices">Prices as of ${esc(P.effectiveFrom)}</span>` : ""}
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
/* СТРАНИЦА «THE NUMBERS»: ОДИН ЛИСТ ИЛИ ДВА — ПО ТОМУ, ЧТО НА НЕЙ ЛЕЖИТ.
   На листе всегда две таблицы (итоги и затраты первого года) и два поясняющих
   блока — «что означает эта цифра» и оговорка про основания расчёта. В базовом
   виде это помещается. Но лист несёт ещё два блока, которые появляются не всегда:

     • включённый переключатель выручки добавляет в первую таблицу две строки
       (прирост выручки и потенциал базы) — это ~96px;
     • превышение порога достоверности добавляет предупреждение — это ~173px.

   Замер: с одной только выручкой низ подвала уезжал на 1116px при полосе 1054 —
   срезало колонтитул целиком; с выручкой и предупреждением сразу и длинным
   названием партнёра — на 1343px, то есть терялись и оговорка, и подвал.
   Ужимать нельзя ни то, ни другое: предупреждение о недостоверности оценки —
   единственное место, где документ говорит клиенту, что цифры могут двоиться,
   а оговорка про основания расчёта объясняет, из чего они вообще взялись.

   Поэтому когда лист несёт хоть один из этих двух блоков, оба поясняющих блока
   уходят на второй лист — тем же приёмом, что на странице тарифа. Цифры и
   предупреждение остаются вместе на первом: предупреждение относится к ним, и
   разлучать его с ними было бы хуже, чем перенести пояснения. */
/* «THE NUMBERS» — ВСЕГДА ТРИ ЛИСТА, И УСЛОВНОГО РАЗБИЕНИЯ БОЛЬШЕ НЕТ.
   Раньше их было один или два, по содержимому (выручка, предупреждения, режим).
   С появлением мощности — часы, штатные единицы, кэш-эффект, окупаемость —
   замер показал, что не держится НИ ОДНА конфигурация: плотное состояние
   уходило на 228px за полосу, мягкое замечание на 214px, а calc-state-all даже
   без предупреждения — на 3px. Три пикселя лечатся кеглем за минуту, и ровно
   поэтому лечить их так нельзя: подгонка развалится от первого более длинного
   имени партнёра.

   Поэтому ветка убрана целиком — тем же решением и по той же причине, что у
   страницы «Recommended plan» (см. README, «Sheets that split»): шесть пикселей
   там тоже были тривиальны, а фит ломался от первого длинного названия тарифа.
   Условное разбиение, которое иногда не срабатывает, хуже безусловного.

   Листы получили СВОИ ТЕМЫ, а не остаток места:
     1/3  The numbers            — что клиент получает: деньги, часы, кэш
     2/3  First-year cost        — что он платит и когда это вернётся
     3/3  How to read these numbers — предупреждения, основания, чувствительность
   ЗАМЕРЕНО, А НЕ ВЫБРАНО. Вариант в два листа (обе таблицы вместе, оба
   предупреждения на второй) пробовался и НЕ ДЕРЖИТСЯ: плотное состояние уходит
   на 181px за полосу, calc-state-all — на 189px. Две таблицы плюс поясняющая
   рамка на один A4 не влезают, и это не вопрос вкуса.
   Цена — лист «First-year cost» выходит воздушным: пять строк таблицы и оговорка.
   Это принято сознательно: воздух в клиентском PDF не дефект, а срезанный подвал
   дефект. */
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
        <tr><td>Payroll saving${/* ДОПУЩЕНИЕ В САМОЙ ПОДПИСИ СТРОКИ — тем же приёмом, каким
              помечены оценки в строках выручки («Additional: revenue uplift (estimate)»).
              Выбрано осознанно вместо блока или отдельной строки под таблицей: подпись
              строки не стоит ни одного пикселя высоты и стоит РЯДОМ с цифрой, к которой
              относится. Доля тут же, чтобы допущение читалось без перехода на другой лист. */
              R ? ` (${esc(R.case)}, ${int(R.pct)}% of named time)` : ""}</td><td>${money(T.fotMonth)}</td><td>${money(T.fotYear)}</td></tr>
        ${/* ЧАСЫ СРАЗУ ПОД ДЕНЬГАМИ — та же величина в единицах, которые клиент
             может сверить по своим данным. Деньги остаются первой строкой: это
             решение заказчика, мощность встаёт рядом, а не вместо.
             КЭШ-ЭФФЕКТ ТРЕТЬЕЙ СТРОКОЙ, И ОН ПУСТ. Прочерк, а не «$0»: ноль в
             колонке денег читается как «ничего не даёт», а здесь эффект есть,
             он просто не в кассе. Вопрос «мы кого-то уволим?» задают первым, и
             отвечать на него лучше до того, как он задан. */
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

  /* ЛИСТ 2 — ЗАТРАТЫ И ОКУПАЕМОСТЬ. Они уехали с первого листа вместе, и это не
     остаток места: «сколько это стоит и когда вернётся» — один вопрос, и оговорка
     про неоценённые сценарии относится к обеим строкам сразу. */
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
        ${/* ОКУПАЕМОСТЬ ПЕЧАТАЕТСЯ ТОЛЬКО КОГДА ОЦЕНЕНЫ ВСЕ СЦЕНАРИИ. Решение принято
             в модели, здесь только его исполнение: при неполных затратах дробь выходит
             короче настоящей ровно на то, что не вписано, а окупаемость — та цифра,
             которой финансовый директор доверяет больше всего. Вместо числа — причина. */
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
  <!-- ПЕРВОЕ ПОЯВЛЕНИЕ СЛОВА «ALAIO» В ДОКУМЕНТЕ — проверено по собранному отчёту:
       до этой строки его нет ни на обложке, ни на листе цифр, а здесь оно приходит
       названием тарифа в строке подписки. Западный клиент этого слова никогда не
       слышал, поэтому один раз и коротко: что это за ряд тарифов и чем он
       отличается от того, на котором клиент сидит. Ни слова рекламы — только то,
       что стоит в самом прайсе: два ряда, AI есть в одном. Дальше по документу
       название повторяется без пояснений: расшифровка нужна однажды. -->
  <p class="b24-small" style="margin-top:var(--b24-s3)">
    Vibe+ is the variant of a Bitrix24 plan that includes the AI features; Essential is the same plan without them, for the same number of users.</p>
  ${footer()}
</section>`;

  /* ЛИСТ 3 — КАК ЧИТАТЬ ЦИФРЫ. Сюда переехало ОБА предупреждения о достоверности:
     раньше предупреждение по экономии ФОТ оставалось при цифрах, а по выручке
     уезжало сюда. Теперь оба здесь, и это честнее по смыслу — лист ровно так и
     называется, а предупреждение это и есть инструкция по чтению. */
  const third = `
<section class="page page--sky">
  ${runhead("Summary")}
  <h1 class="b24-h1">How to read these numbers${num(3)}</h1>
  ${overlapBlock()}
  ${revenueBlock()}

  <div class="b24-quote">
    ${/* ОСНОВАНИЕ РАСЧЁТА, БЕЗ МЕХАНИКИ. Здесь стояла ещё фраза о том, что число
         рабочих дней задаёт обе части дроби и потому не двигает деньги дневных
         сценариев (правка P5). Убрана из отчёта по двум причинам: замер — лист
         3/3 уходил на 26px за полосу набора; и по адресату — рабочие дни ставит
         ПАРТНЁР, а не клиент, и объяснение, почему поле не завышает итог, нужно
         тому, у кого это поле есть. Оно стоит в подсказке поля на экране.
         Клиенту нужно основание: сколько часов в месяце и сколько стоит час. */
      ""}Payroll saving is the sum of the selected scenarios over twelve months. A month here is
    ${int(S.economics.daysMonth)} working days, which is ${int(S.economics.contractHours)} paid
    hours, and one hour costs the gross salary plus a
    ${int(S.economics.burdenPct)}% employer payroll burden, divided by those hours.
    ${S.showRevenue ? "Revenue figures are projections and are shown separately. They never enter the net saving." : "This report leaves revenue projections out."}
    ${/* ТЕКСТ ПРИХОДИТ ГОТОВЫМ ИЗ СОСТОЯНИЯ — тем же порядком, что оба
         предупреждения: формулировка обязана быть одна на экране и в документе,
         иначе партнёр говорит клиенту одно, а бумага другое. */
      R && R.text ? esc(R.text) : ""}
    ${/* ЧУВСТВИТЕЛЬНОСТЬ И КЭШ — тоже готовыми строками, из того же состояния.
         Чувствительность выражена через режимы, а не отдельным «если половина»:
         переключатель отвечает на тот же вопрос, и два числа про одно и то же
         рядом заставили бы читателя выбирать, какое применено. */
      CAP && CAP.sensitivityText ? esc(CAP.sensitivityText) : ""}
    ${CAP && CAP.cashNote ? `<span class="b24-strong">Cash effect.</span> ${esc(CAP.cashNote)}` : ""}
  </div>
  ${footer()}
</section>`;
  return first + second + third;
};


/* ПРЕДУПРЕЖДЕНИЕ ПО ВЫРУЧКЕ. Та же логика, что у overlapBlock: клиент вправе
   знать, что прогноз выше уровня, который мы считаем защитимым, — умолчать было
   бы нечестным выбором. Текст приходит ГОТОВЫМ из состояния (`revGuard.text`),
   отчёт его не сочиняет и процент не пересчитывает: формулировка обязана быть
   одна на экране и в документе, иначе партнёр говорит клиенту одно, а бумага
   другое. Нет текста — нет и блока; состояния, снятые до этой правки, поля не
   несут и печатать им нечего. */
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

/* Credibility warnings — BOTH travel into the report. The client is entitled to know
   where the estimate sits against the range we treat as normal; hiding it would be the
   dishonest choice.

   ДВА ПОРОГА — ДВА РАЗНЫХ БЛОКА, И ОНИ ОТЛИЧАЮТСЯ ПО СИЛЕ ВИДА, А НЕ ТОЛЬКО ПО
   СЛОВАМ. Жёсткое (>25%) — янтарная рамка, как была, и формулировка не менялась:
   она утверждает двойной счёт. Мягкое (>15%) — та же рамка в штатном синем,
   потому что оно НИЧЕГО не утверждает о двойном счёте: расчёт на 15-25% ФОТ может
   быть защитимым, он просто выше обычного. Одинаково окрашенные блоки через
   неделю сливаются в один шум, и тогда жёсткое перестаёт работать.

   Строка о происхождении диапазона стоит в обоих: без неё это число без
   родословной — ровно та претензия, из которой находка выросла.
   Печатается ровно один блок: какой, говорит level. Состояния, снятые до этой
   правки, level не несут — для них работает прежняя ветка по ok. */
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
</section>`).join("");

/* ---------- inputs used, chunked (transparency: the client can check our numbers) ---------- */
/* Отметка у цифр клиента. Тот же приём, что у пометки сценариев на AI-агентах:
   надстрочный знак плюс объяснение под таблицей. */
const CLIENT_MARK = '<sup class="b24x-gate-mark">\u2022</sup>';
/* ================================================== ЛИСТ ДОПУЩЕНИЙ (P16) =====
   ЭТО НЕ НОВЫЙ ЛИСТ, А ПЕРЕСТРОЕННЫЙ СТАРЫЙ, и это главное решение задачи.
   Страница «The numbers we entered» уже перечисляла КАЖДОЕ введённое значение по
   каждому выбранному сценарию, включая сегменты. Разбор просил «полную таблицу
   всех введённых значений со столбцом происхождения» — то есть ту же таблицу плюс
   один столбец. Второй таблицы тех же чисел в документе быть не должно: она
   немедленно порождает вопрос «а почему они разные?», даже когда они одинаковые.
   Поэтому старая страница получила столбец происхождения, блок общих допущений и
   новое имя, а не соседа.

   ЧТО ИЗМЕНИЛОСЬ ПО ФОРМЕ. Значения шли строкой через точку-разделитель
   («поле: значение · поле: значение»), и шесть полей в такой строке глазами не
   сканируются. Финансисту нужно ровно сканирование: найти величину, посмотреть
   происхождение, решить, верит ли он. Поэтому таблица в три колонки. Дороже по
   высоте — за это платит разбиение, а не кегль.

   ТОЛЬКО ВЫБРАННЫЕ СЦЕНАРИИ, А НЕ ВСЕ 48 ПОЛЕЙ. Это не компромисс по месту, а
   единственный правильный ответ: задача листа — защитить ИМЕННО ЭТУ сумму. Поля
   невыбранных сценариев в неё не входили, и печатать их значило бы приглашать
   вопрос «а это откуда здесь?». Поля, скрытые выключенным переключателем выручки,
   не печатаются по той же причине — они не участвовали.

   ОБЩИЕ ДОПУЩЕНИЯ ИДУТ ПЕРВОЙ ТАБЛИЦЕЙ. До правки они были размазаны: длина
   месяца пряталась в блоке оснований, режим реализации — в подписи строки итога,
   численность и оклад не печатались вовсе. Финансисту нужно сначала это: на каких
   общих величинах стоит вся сумма.
   ========================================================================== */
/* Вес сценария в листах: заголовок + строка на поле + строка на поле сегмента.
   Считается по фактическому числу полей, а не по числу наборов, потому что
   единица высоты теперь строка таблицы, а не абзац. */
/* СТРОК НА ЛИСТ. Замер: строка таблицы допущений — 35px при коротком названии и
   до 52px, когда название переносится («Time spent after one call, replaying it and
   filling the card»). Полоса набора 1054px, минус заголовок листа и подвал —
   остаётся около 900px, то есть 17 переносящихся строк. Берём 16 с запасом на
   заголовок сценария и подзаголовок сегмента.
   У ПЕРВОГО ЛИСТА БЮДЖЕТ МЕНЬШЕ: на нём стоит блок общих допущений (6 строк плюс
   шапка и отбивка, около 300px). Вычитаем его вес, а не занижаем лимит для всех —
   иначе последние листы стояли бы полупустыми. */
/* БЮДЖЕТ ЛИСТА В «ПОЛОВИНКАХ СТРОКИ», А НЕ В СТРОКАХ.
   Первая версия считала строки поштучно, и это давало выбор из двух плохих
   вариантов: бюджет под плотное состояние (13) оставлял разреженные листы
   заполненными на 40%, а бюджет под разреженные переполнял плотные на 83px.
   Причина в том, что строки РАЗНОЙ ВЫСОТЫ: короткая подпись 35px, переносящаяся —
   52px, то есть ровно полторы. Значит и считать надо полуторками.
   Колонка названия — около 46 знаков в строке при кегле 12.5px на полосе 656px;
   подпись длиннее переносится и весит 3 полуединицы вместо 2.
   Бюджет 32 полуединицы ≈ 16 коротких строк или 10 длинных. Замеры по пути: на
   40 лист уходил на 104px за полосу, на 34 — на 17.8px при 62-символьном имени
   партнёра (подвал с датой цен становится трёхстрочным). 32 держатся на всех
   пяти состояниях. Мерено, а не подобрано под одно. */
const ASSUM_HALF_BUDGET = 32;
const ASSUM_WRAP_CHARS = 46;
/* Подзаголовок сегмента весит больше обычной строки: у него своя отбивка сверху
   (padding-top:8px). Заголовок сценария — обычные две единицы. */
const rowWeight = r => r.t === "field"
  ? (String(r.f.label || "").length > ASSUM_WRAP_CHARS ? 3 : 2)
  : (r.t === "seg" ? 3 : 2);
const ASSUM_ROWS_PER_PAGE = ASSUM_HALF_BUDGET;
/* Блок общих допущений: шесть строк, из них одна переносящаяся, плюс шапка и
   отбивка. В полуединицах — около 18. */
const ASSUM_SHARED_WEIGHT = 18;
const assumWeight = it => 1 + (it.fields || []).length
  + (it.segments || []).reduce((a, fs) => a + 1 + fs.length, 0);

const originCell = o => o ? `<span class="b24x-td-sub" style="display:inline; text-transform:none; letter-spacing:0;">${esc(o)}</span>` : "";

const assumptionPages = () => {
  /* Блок общих допущений стоит только на ПЕРВОМ листе: повторять его на каждом
     значило бы утверждать, что он относится к сценариям этого листа, а он
     относится ко всему расчёту. */
  const shared = (S.assumptions || []).length ? `
  <div class="b24-table-wrap">
    <table class="b24-table b24x-table--assum">
      <thead><tr><th>Across the whole calculation</th><th>Value</th><th>Where it comes from</th></tr></thead>
      <tbody>
        ${S.assumptions.map(a => `<tr><td>${esc(a.label)}</td><td>${esc(a.value)}</td><td>${originCell(a.origin)}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>` : "";

  /* РЕЖЕМ ПО СТРОКАМ, А НЕ ПО СЦЕНАРИЯМ, и вот почему это пришлось переделать.
     Первая версия разбивала список сценариев целиком: сценарий не мог быть разорван
     между листами. Замер показал, что этого не хватает — сценарий 1 с двумя
     сегментами весит 21 строку, то есть БОЛЬШЕ ЦЕЛОГО ЛИСТА, и оставался
     переполненным, сколько бы ни уменьшали бюджет. Сценариев с сегментами может
     быть сколько угодно, значит резать надо внутри.
     Разорванный сценарий получает свой заголовок снова, с пометкой continued: без
     неё вторая половина его полей выглядела бы принадлежащей предыдущему
     сценарию — а это ровно та ошибка чтения, из-за которой лист и заводился. */
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
      /* ВИСЯЧИЙ ЗАГОЛОВОК НЕ ОСТАЁТСЯ ПОСЛЕДНЕЙ СТРОКОЙ ЛИСТА: заголовок сценария
         или подзаголовок сегмента без своих полей читается как пустая рубрика.
         Переносим его на следующий лист вместе с полями. */
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
    /* Если лист начинается с поля, а не с заголовка, — сценарий разорван: дописываем
       его заголовок с пометкой continued. */
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
  ${/* ОДНА СТРОКА ПРО ПРОИСХОЖДЕНИЕ — на последнем листе, чтобы читалась как итог
       таблицы, а не как её преамбула. Столбец уже сказал тип у каждой строки; эта
       строка говорит то, чего в столбце нет: вендорских бенчмарков здесь нет вовсе,
       а помеченные величины — ваши, их надо подтвердить. */
    i === all.length - 1 && S.orgLegend ? `<p class="b24-small" style="margin-top:var(--b24-s3)">
    ${esc(S.orgLegend)}</p>` : ""}
  ${footer()}
</section>`;
  }).join("");
};

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
/* СТРАНИЦА ТАРИФА ВСЕГДА ДВЕ. Раньше разбиение включалось только при раскрытии
   про AI-агентов: считалось, что без него «таблица + что даёт тариф + сноска про
   квоты» на лист помещаются. Замер показал, что нет — вариант БЕЗ раскрытия
   вылезал на 6px, а с длинным названием партнёра (подвал в две строки) на 20px,
   и срезало нижний край колонтитула с номером страницы. Шесть пикселей ничего не
   стоит подобрать кеглем, но подгонка под текущие длины строк развалится от
   первого же более длинного названия тарифа или партнёра.
   Поэтому ветка убрана целиком, а не подкручена: у страницы тарифа одна форма,
   и переполняться в ней нечему. Цена — один лишний лист в отчётах без
   расхождения; лист с содержимым, а не с воздухом: на нём «What <тариф> adds»,
   перечень линейки и сноска про квоты.
   Нумерация (1/2) — та же, что у разбитых страниц сценариев. */
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
  ${gated.length ? `
  <!-- РАСКРЫТИЕ РАСХОЖДЕНИЯ. Стоит на странице тарифа, а не на первой: читатель
       здесь как раз выбирает тариф, и решение принимается тут. Первую страницу
       не трогаем намеренно — итог там честный (экономию считали по всем
       выбранным сценариям, формулы не менялись), а дублировать оговорку на
       каждой странице значит превратить продающий документ в дисклеймер.
       Ссылка на строки таблицы держится на том же знаке †, что и сноска. -->
  <div class="b24-dashed" style="margin-top:var(--b24-s6); border-color:#A15C00;">
    <p class="b24-p" style="margin:0; font-size:13.5px; color:#A15C00;">
      <span class="b24-strong" style="color:#A15C00;">${gated.length === 1 ? "One of these scenarios needs an AI agent." : `${int(gated.length)} of these scenarios need an AI agent.`}</span>
      AI agents are included from ${esc(gate.minPlan)} up, so they are not available on ${esc(P.to)}:
      ${gate.titles.map(x => esc(x)).join(", ")}.
      ${money(gate.fotYear)} of the payroll saving a year comes from them.
      Two honest ways forward: move to ${esc(gate.minPlan)}, which includes agents, or start with the
      other scenarios and add these in a second step once the plan allows it.
    </p>
  </div>` : ""}

  <p class="b24-p">Plan prices are for the whole account, not per user. The number in an Enterprise tier (250, 500, 1000 …) is the seat limit the plan includes, and the price already covers it. Nothing above is multiplied by headcount.</p>

  ${footer()}
</section>`;
  /* На второй странице заголовок страницы и есть «What <тариф> adds» — двух
     заголовков подряд быть не должно, поэтому он полноразмерный и с нумерацией. */
  return first + `
<section class="page page--sky">
  ${runhead("Recommended plan")}
  <h1 class="b24-h1">What ${esc(P.to)} adds${num(2)}</h1>
  <ul class="b24-checklist">
    ${aiLine()}
    <!-- ОСТАЛЬНЫЕ ПУНКТЫ — ОФИЦИАЛЬНАЯ РАЗНИЦА ЭТОГО ТАРИФА, а не пересказ линейки.
         Раньше здесь стояли три наши строки из партнёрского гида, одинаковые для
         любой цели: разницы между Basic Vibe+ и Enterprise Vibe+ они не показывали
         вовсе, хотя она есть — админы, письма, производительность REST.
         Теперь состояние приносит готовый список (planDelta), собранный из
         PRICING.vibeDelta: построчный дифф страницы сравнения тарифов, 11 строк из
         880, названиями со страницы. Решение «какой набор относится к этому
         тарифу» принимается в index.html рядом с именем тарифа — здесь только
         печать, как и у AI-ступени.
         Запасной путь для состояний старого формата (planDelta нет) — прежние три
         строки: потерять содержимое молча хуже, чем напечатать менее точное. -->
    ${(Array.isArray(S.planDelta) && S.planDelta.length
        ? S.planDelta
        : ["Vibecode platform", "MCP server — connect external AI systems to your Bitrix24",
           "Unlimited REST API and Bitrix24 Market"]
      ).map(x => `<li class="is-yes">${esc(x)}</li>`).join("\n    ")}
  </ul>

  <div class="b24-dashed" style="margin-top:var(--b24-s6)">
    <p class="b24-p" style="margin:0; font-size:13.5px;">
      AI is set by plan, not by a request count. No per-request quotas are published, so no numeric AI limits are quoted here. Prices apply from ${esc(P.effectiveFrom)}. Existing clients keep their current pricing until the end of their period or ${esc(P.grandfatheredUntil)}, whichever is later.
    </p>
  </div>

  ${footer()}
</section>`;
};


/* ================================================= ЛИСТ ПРЕДЛОЖЕНИЯ (P16) ====
   ЧЕСТНО: ЭТО ЗАГОТОВКА, И ЛИСТ ГОВОРИТ ЭТО ВСЛУХ. Состав работ у каждого
   партнёра свой, и выдумать его за него нельзя. Но и пустой лист с полями «впишите
   сами» отдавать клиенту нельзя тоже. Поэтому лист собран из ТОГО, ЧТО МЫ ЗНАЕМ
   ТОЧНО, а знаем мы больше, чем кажется:

     ЧТО ВХОДИТ — список выбранных сценариев. Это и есть состав фазы 1 на том
       уровне, который клиента интересует: не «две сессии и настройка воронки», а
       «подключаем расшифровку звонков и агента по базе знаний». Выведено из
       расчёта, ничего не придумано.
     СКОЛЬКО СТОИТ — итог услуг партнёра плюс годовая подписка. Обе величины уже
       посчитаны моделью.
     КОГДА НАЧАТЬ — поле партнёра, свободной строкой. Пустое печатается как
       «to be agreed», а не как выдуманная дата.
     ЧТО ИМЕННО ЗА РАБОТА — поле партнёра. Пустое НЕ печатается вовсе: список
       сценариев уже несёт смысл, а строка-заглушка в документе у клиента выглядела
       бы как недоделка.

   ПОСТАТЕЙНЫХ ЦЕН УСЛУГ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Это инвариант проекта: в
   клиентский отчёт идёт ОДНА итоговая строка внедрения, разбивка по сценариям —
   партнёрская экономика. Список сценариев печатается БЕЗ сумм рядом. Проверяется
   аудитом (auditClient), и правило там теперь не только про заголовок, но и про
   сами цифры.
   ========================================================================== */
/* СТРОК СОСТАВА НА ЛИСТ. Замер: строка списка сценариев около 44px, вступительный
   абзац и шапка таблицы съедают около 200px, таблица цены с тремя строками около
   190px, блок с датой около 90px. На одном листе цена и дата обязаны стоять вместе
   с последней частью состава — это одно предложение, а не два. Отсюда восемь строк
   на лист с ценой и двенадцать на лист без неё. */
/* СКОЛЬКО СТРОК СОСТАВА УМЕЩАЕТСЯ ВМЕСТЕ С ЦЕНОЙ. Выше этого числа цена уезжает на
   свой лист целиком.
   ЧЕТЫРЕ, И ЭТО ЗАМЕР, А НЕ ОСТОРОЖНОСТЬ. На пяти строках лист уходил на 11.9px за
   полосу — при 62-символьном названии партнёра, где подвал с датой актуальности цен
   становится трёхстрочным. Пробовал шесть и пять, обе версии переполнялись именно
   на этом состоянии.
   Цена такого решения понятна и приемлема: при пяти и более сценариях предложение
   занимает два листа — полный состав на первом, цена и дата на втором. Это читается
   как два разворота предложения, а не как разорванный список: состав НИКОГДА не
   рвётся, пока умещается в PROPOSAL_ROWS_FIRST. */
const PROPOSAL_ROWS_LAST = 4;
const PROPOSAL_ROWS_FIRST = 12;
const proposal = () => {
  const items = S.items || [];
  const unpriced = T.serviceUnquoted || 0;
  const start = (PT.startDate || "").trim();
  const note = (PT.scopeNote || "").trim();
  const firstYear = (T.serviceSum || 0) + (T.subscriptionYear || 0);
  /* РАЗБИЕНИЕ, А НЕ УЖАТИЕ — но разбивать надо ПРАВИЛЬНОЕ.
     Первая версия дробила список сценариев так, чтобы последняя часть уместилась
     вместе с ценой. На пяти сценариях это дало один сценарий на первом листе и
     четыре на втором: первый лист на девяносто процентов пустой, и документ
     выглядит сломанным, хотя по полосе набора всё в порядке.

     Правильное деление — по СМЫСЛУ, а не по остатку места: пока состав умещается с
     ценой, лист один; когда не умещается, цена уезжает на свой лист целиком.
     Получается «что входит» и «сколько стоит и когда начинаем» — два разворота
     предложения, а не разорванный список. */
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
  /* Всего листов: листы состава плюс лист цены, если она не влезла к составу. */
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

  /* СБОРКА. Один лист, когда состав умещается с ценой; иначе листы состава плюс
     лист цены. Вступительный абзац — только на первом. */
  const scopeSheets = scopeChunks.map((rows, i) => `
<section class="page page--sky">
  ${head(i)}
  ${i === 0 ? intro : ""}
  ${scopeTable(rows, i, scopeChunks.length)}
  ${oneSheet ? priceBlock : ""}
  ${footer()}
</section>`).join("");
  if (oneSheet) return scopeSheets;
  return scopeSheets + `
<section class="page page--sky">
  ${head(total - 1)}
  ${priceBlock}
  ${footer()}
</section>`;
};

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
  assumptionPages(),
  planPage(),
  proposal(),
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

  /* ДАТА АКТУАЛЬНОСТИ ЦЕН В ПОДВАЛЕ. Своей строкой под именем партнёра, а не
     приписью к нему: имя бывает 62 символа, и на длинном имени одна строка уехала
     бы за полосу набора. Приглушённым кеглем — это сноска к документу, а не его
     содержание. Подвал в ките — флекс-строка, поэтому обёртка получает
     flex-direction:column у правой половины. */
  .b24-footer{align-items:flex-end}
  .b24x-foot-prices{display:block; font-family:var(--b24-font-body); font-weight:600;
                    font-size:9.5px; color:var(--b24-text-mute); margin-top:2px;
                    text-align:right}

  /* ЛИСТ НЕ РВЁТСЯ НА ПЕЧАТИ, И ЗАГОЛОВОК НЕ ОТРЫВАЕТСЯ ОТ СВОЕГО БЛОКА (P15).
     Кит объявляет .page { break-after: page }, то есть КОНЕЦ листа. Но не
     запрещает разрыв ВНУТРИ листа: если содержимое окажется хоть на пиксель выше
     печатной области — из-за другой метрики шрифта в чужом движке, — лист
     разъедется на две печатных страницы, и его подвал с локапом уедет на пустую.
     Замер Chromium против Gecko дал расхождение 1px на 1123, то есть сейчас этого
     не происходит; правило стоит как страховка на движки, которые мы измерить не
     смогли (WebKit требует включить Remote Automation вручную).
     Живёт в отчёте, а не в brand-ext.css: в документ подключён только кит, и отчёт
     обязан быть самодостаточным. Кит при этом не редактируется — он только вход
     сборки.
     Заголовкам и шапкам таблиц запрещён разрыв ПОСЛЕ них: если движок всё же начнёт
     переносить, заголовок уйдёт вместе со своими строками, а не останется вдовой. */
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

  /* ЛИСТ ДОПУЩЕНИЙ. Три колонки: величина, значение, происхождение. Колонка
     происхождения самая узкая — это метка, а не текст, — и не переносится по
     словам, иначе «carried over» встаёт столбиком. */
  .b24x-table--assum tbody td:nth-child(3),
  .b24x-table--assum thead th:nth-child(3){width:1%; white-space:nowrap}
  .b24x-table--assum tbody td{padding:9px 12px; font-size:12.5px}
  .b24x-table--assum thead th{padding:11px 12px; font-size:13px}
  .b24-table tbody td.b24x-est{color:var(--b24-text-mute)}
  /* Знак † у названия сценария, которому нужен AI-агент. Цвет — тот же
     предупреждающий #A15C00, что у блока про порог достоверности и у раскрытия
     на странице тарифа: один смысл, один цвет. Не жирный и не крупнее строки —
     знак должен уводить к сноске, а не спорить с названием сценария. */
  .b24x-gate-mark{color:#A15C00; font-weight:700; font-size:.8em; padding-left:1px}
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
  const hits = auditClient(html, P, money,
    {items: S.items || [], serviceSum: (S.totals || {}).serviceSum || 0});
  /* ОБЯЗАТЕЛЬНОЕ РАСКРЫТИЕ — это не «внутреннее в отчёте», а наоборот: то, что
     обязано в нём быть. Поэтому список отдельный: у него другая причина и другая
     формулировка отказа. Реакция та же — сборка не состоится. */
  /* ОШИБКА ВВОДА БЛОКИРУЕТ СБОРКУ. Состояние с невалидным сценарием внутренне
     согласовано — модель его просто исключила, — и именно поэтому отчёт из него
     опасен: он молча не содержит сценария, который партнёр выбрал и показал
     клиенту на экране. Отказ, а не оговорка. */
  const blocked = (S.invalid || []).map(x =>
    `scenario "${x.title}" has an input error and was left out of every total`)
  /* ПОЛЯ ВНЕ СЦЕНАРИЕВ — В ТОТ ЖЕ ОТКАЗ. Численность и оклад входят в знаменатель
     предохранителя, рабочие дни и нагрузка — в стоимость часа: испорченное поле
     шага 1 портит не один сценарий, а весь документ. Состояния, снятые до правки
     P12, поля inputErrors не несут, и для них ветка просто пуста. */
    .concat((S.inputErrors || []).map(x =>
      `"${x.label}" in the company details is not a usable figure: ${x.text}`));
  const missing = requiredDisclosures(html, gate, gated, GATE_MARK, money, {
    required: disclosureRequired, planCarriesAgents,
    ids: AGENT_SCENARIO_IDS, items: S.items || [],
  });
  return {html, pageCount, hits, missing, blocked};
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


/* =============================================================================
   ОБЯЗАТЕЛЬНЫЕ РАСКРЫТИЯ. Зеркало auditClient: тот следит, чтобы в документ не
   попало лишнее, этот — чтобы из него не выпало нужное.
   Правило одно: если экономия в отчёте построена на сценариях, недоступных на
   рекомендованном тарифе, документ обязан это сказать. Молчащий отчёт хуже
   отсутствующего — по нему клиент купит тариф, на котором обещанного не будет.
   Проверяются ОБА носителя раскрытия, потому что они делают разную работу:
   знак у строки говорит «этот сценарий», абзац на странице тарифа — «вот
   сколько и вот что делать». Потеря любого из них ломает раскрытие.
   ========================================================================== */
function requiredDisclosures(doc, gate, gated, mark, money, own) {
  const out = [];
  /* СВЕРКА ОПРЕДЕЛЕНИЙ. Признак сценария (agent:true) и признак тарифа заданы в
     двух местах — в калькуляторе и здесь. Пока состояние несёт их с собой, они
     обязаны совпадать; расхождение означает, что один из списков забыли
     обновить, и любой вывод про доступность после этого недостоверен. Это не
     предупреждение: сборка не состоится. */
  if (gate && gate.planHasAgents !== own.planCarriesAgents)
    out.push(`the plan lists disagree: the calculator says agents ${gate.planHasAgents ? "ARE" : "are NOT"} ` +
             `available on this plan, the report says they ${own.planCarriesAgents ? "ARE" : "are NOT"}`);
  const marked = (own.items || []).filter(it => it.needsAgent === true).map(it => it.id);
  if (marked.length || (own.items || []).some(it => "needsAgent" in it)) {
    const mine = (own.items || []).filter(it => own.ids.has(it.id)).map(it => it.id);
    if (marked.slice().sort().join(",") !== mine.slice().sort().join(","))
      out.push(`the scenario lists disagree: the calculator marks [${marked}] as agent-based, ` +
               `the report knows [${mine}]`);
  }

  if (!own.required && !gated.length) return out;

  /* СОСТОЯНИЕ СТАРОГО ФОРМАТА. Раскрывать надо — это видно по id сценариев и по
     имени тарифа, они есть в любом сохранении, — а данных для раскрытия в файле
     нет: ни состава, ни суммы. Посчитать их здесь нельзя: отчёт в этом проекте
     не выводит величины сам, он печатает то, что посчитала модель. Значит
     собирать нечего — отказываемся и просим переснять расчёт.
     В браузере этот путь недостижим: печать всегда идёт от свежего
     reportState(). Он существует только для сборки из лежащего на диске JSON. */
  if (own.required && !gated.length)
    return out.concat("the calculation was saved before the AI-agent check and cannot say which " +
                      "scenarios need an agent, or how much of the saving depends on them — " +
                      "re-export it from the calculator");

  const flat = x => String(x).replace(/\s+/g, " ");
  const hay = flat(visibleText(doc));
  /* ДВЕ ПОВЕРХНОСТИ, ДВЕ ПРОВЕРКИ. Раскрытие держится на знаке у строки и на
     сноске под таблицей, и одного «† встречается в тексте» на них не хватает:
     убери знак у строк — сноска оставит † на месте, убери сноску — знаки
     останутся у строк. Обе подмены сборку проходили. Поэтому знаки считаются
     (по одному на каждую недоступную строку плюс минимум один в сноске), а
     сноска ищется целиком, вместе со знаком перед ней. */
  const marks = hay.split(mark).length - 1;
  if (marks < gated.length + 1)
    out.push(`the ${mark} marker next to every scenario that needs an AI agent ` +
             `(found ${marks}, expected at least ${gated.length + 1}: one per row plus the footnote)`);
  if (!hay.includes(flat(`${mark} ${gate.rowNote}`)))
    out.push(`the footnote under the scenario table explaining the ${mark} marker`);
  if (!hay.includes(gate.minPlan))
    out.push(`the name of the plan that includes agents (${gate.minPlan})`);
  /* Именно СУММА, а не «упоминание где-нибудь»: без неё раскрытие не даёт
     читателю масштаба, а фраза «N scenarios need an agent» прошла бы проверку
     сама по себе. Ту же ошибку мы уже ловили на колонке выручки. */
  const figure = flat(money(gate.fotYear));
  if (!hay.includes(figure))
    out.push(`the amount of saving that depends on agents (${figure})`);
  /* Названия недоступных сценариев: перечень — половина смысла раскрытия, без
     него читателю негде посмотреть, о каких именно строках речь. */
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
  const hits = banned.filter(([, re]) => re.test(hay)).map(([label]) => label);

  /* ПОСТАТЕЙНЫЕ ЦЕНЫ УСЛУГ — РАЗБИВКА, А НЕ ПРОСТО СОВПАВШАЯ СУММА.
     Запрет на разбивку был записан в инварианте и в комментарии, а проверялся
     только по заголовку «my services»: таблица с теми же суммами без этого
     заголовка прошла бы аудит. Появление листа предложения (P16) сделало это
     опасным на практике: лист печатает список сценариев, и приписать к каждому его
     цену — соблазн в одну строку кода.

     ПЕРВАЯ ВЕРСИЯ ПРАВИЛА ИСКАЛА САМУ СУММУ В ТЕКСТЕ И ДАЛА ЛОЖНОЕ СРАБАТЫВАНИЕ:
     на плотном состоянии $5,000 — это оклад менеджера в сегменте сценария 1, а не
     цена услуги. Денежные величины в документе совпадают сплошь, и «сумма
     встречается где-нибудь» ничего не доказывает.

     Поэтому ищется РАЗБИВКА как таковая: строка таблицы, в которой стоят и
     название сценария, и его собственная цена. Это и есть запрещённая конструкция,
     а совпадение суммы в другом месте — не она. */
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

