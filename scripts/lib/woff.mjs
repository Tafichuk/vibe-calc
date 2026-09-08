/**
 * woff.mjs — TTF -> WOFF 1.0, БЕЗ ВНЕШНИХ ЗАВИСИМОСТЕЙ.
 *
 * ЗАЧЕМ. Документ, который уходит наружу одним файлом, несёт шрифт внутри себя —
 * иначе фирстиль рассыпается ровно там, где документ читают. Вариативный
 * Montserrat из кита весит 688 КБ, а в base64 — 897 КБ.
 *
 * ПОЧЕМУ WOFF, А НЕ WOFF2. WOFF2 требует brotli с преобразованием glyf/loca и без
 * библиотеки не собирается. WOFF 1.0 — это ровно те же таблицы sfnt, каждая
 * сжатая zlib, в описанном контейнере; zlib есть в самом Node. Экономия около
 * половины, поддержка с 2010 года, внешних зависимостей ноль.
 *
 * ПРОВЕРЯТЬ РЕЗУЛЬТАТ ОБЯЗАТЕЛЬНО. Кривой WOFF не даёт ошибки: браузер молча
 * берёт системный шрифт, и документ выглядит «почти так же».
 */
import zlib from "node:zlib";

const TTF_HEAD = 12, REC = 16, WOFF_HEAD = 44, WOFF_REC = 20;
const align4 = n => (n + 3) & ~3;

export function ttfToWoff(ttf){
  if (ttf.length < TTF_HEAD) throw new Error("woff: файл короче заголовка sfnt");
  const flavor = ttf.readUInt32BE(0);
  /* 0x00010000 — TrueType, 'OTTO' — CFF. Вариативный Montserrat из кита это
     TrueType с таблицами fvar/gvar; WOFF 1.0 переносит любые таблицы sfnt. */
  if (flavor !== 0x00010000 && flavor !== 0x4F54544F)
    throw new Error(`woff: незнакомая версия sfnt 0x${flavor.toString(16)}`);
  const numTables = ttf.readUInt16BE(4);

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const p = TTF_HEAD + i * REC;
    tables.push({
      tag:      ttf.readUInt32BE(p),
      checksum: ttf.readUInt32BE(p + 4),
      offset:   ttf.readUInt32BE(p + 8),
      length:   ttf.readUInt32BE(p + 12),
    });
  }
  /* Каталог WOFF обязан идти по возрастанию тега. В исходнике он обычно уже
     такой, но полагаться на это нельзя. */
  tables.sort((a, b) => a.tag - b.tag);

  for (const t of tables) {
    const raw = ttf.subarray(t.offset, t.offset + t.length);
    if (raw.length !== t.length) throw new Error("woff: каталог указывает за пределы файла");
    const z = zlib.deflateSync(raw, { level: 9 });
    /* СЖАТИЕ ПРИМЕНЯЕТСЯ ТОЛЬКО ЕСЛИ ОНО ПОМОГЛО. Равные длины в WOFF означают
       «хранится как есть» — обязательное правило формата, а не оптимизация:
       уже сжатые таблицы от deflate распухают. */
    t.data = z.length < raw.length ? z : raw;
    t.comp = t.data.length;
  }

  const totalSfntSize = TTF_HEAD + REC * numTables
    + tables.reduce((n, t) => n + align4(t.length), 0);

  let off = WOFF_HEAD + WOFF_REC * numTables;
  const blocks = [];
  for (const t of tables) {
    t.woffOffset = off;
    blocks.push(t.data);
    off += t.comp;
    const pad = align4(off) - off;
    if (pad) { blocks.push(Buffer.alloc(pad)); off += pad; }
  }

  const head = Buffer.alloc(WOFF_HEAD);
  head.write("wOFF", 0, "ascii");
  head.writeUInt32BE(flavor, 4);
  head.writeUInt32BE(off, 8);              // length всего файла
  head.writeUInt16BE(numTables, 12);
  head.writeUInt16BE(0, 14);               // reserved
  head.writeUInt32BE(totalSfntSize, 16);
  head.writeUInt16BE(1, 20);               // majorVersion
  head.writeUInt16BE(0, 22);               // minorVersion
  /* metaOffset/metaLength/metaOrigLength и privOffset/privLength — нули:
     метаданных и приватного блока не переносим. */

  const dir = Buffer.alloc(WOFF_REC * numTables);
  tables.forEach((t, i) => {
    const p = i * WOFF_REC;
    dir.writeUInt32BE(t.tag, p);
    dir.writeUInt32BE(t.woffOffset, p + 4);
    dir.writeUInt32BE(t.comp, p + 8);
    dir.writeUInt32BE(t.length, p + 12);
    dir.writeUInt32BE(t.checksum, p + 16);
  });

  return Buffer.concat([head, dir, ...blocks]);
}
