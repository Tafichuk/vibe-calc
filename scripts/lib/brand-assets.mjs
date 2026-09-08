/**
 * brand-assets.mjs — ФИРСТИЛЬ, ВСТРОЕННЫЙ В ОДИН ФАЙЛ.
 *
 * Встраивание фирстиля для документа, который уходит наружу одним файлом и
 * обязан открываться с file:// без сети: с file:// внешний <link> молча
 * отваливается, и Montserrat подменяется системным шрифтом — то есть документ
 * перестаёт быть в фирстиле именно там, где его читают.
 *
 * КИТ НЕ РЕДАКТИРУЕТСЯ. Здесь он только ЧИТАЕТСЯ, а подстановки делаются в копии
 * строки. assets/bitrix24-kit.css — вход сборки, и таким остаётся.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ttfToWoff } from "./woff.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const asset = rel => path.join(REPO, "assets", rel);

const MIME = {".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp"};
export function dataUri(absPath){
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME[ext];
  if(!mime || !fs.existsSync(absPath)) return null;
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

/* Две плашки логотипа. НИКОГДА не совмещённый блок: два отдельных знака. */
export const LOCKUP = {
  dark:  dataUri(asset("logo-partner-h.png")),
  white: dataUri(asset("logo-partner-h-white.png")),
};

/* Шрифт: ОДИН вариативный файл вместо семи статических. Он покрывает все
   начертания, которые просит кит, и весит меньше суммы статических.
 *
 * ФОРМАТ — ПАРАМЕТР, И ПО УМОЛЧАНИЮ ОСТАЁТСЯ TTF.
 * В base64 вариативный TTF занимает 897 КБ; тот же шрифт в WOFF 1.0 — 372 КБ, то
 * есть на 59% меньше при том же начертании. Клиентскому отчёту это не нужно и
 * формат там не меняется: геометрия листов A4 промерена на метриках именно
 * этого файла, а печать в PDF — единственный путь партнёра к документу. Менять
 * проверенный путь ради веса, который здесь никого не жмёт, незачем.
 */
export function fontFaceCss({ warn = console.warn, format = "ttf" } = {}){
  const vf = asset("fonts/Montserrat-VariableFont_wght.ttf");
  if(!fs.existsSync(vf)){
    warn("brand-assets: assets/fonts/Montserrat-VariableFont_wght.ttf missing — "
       + "the document will fall back to a system font.");
    return "";
  }
  const ttf = fs.readFileSync(vf);
  const [buf, mime, fmt] = format === "woff"
    ? [ttfToWoff(ttf), "font/woff", "woff"]
    : [ttf, "font/ttf", "truetype-variations"];
  const uri = `data:${mime};base64,${buf.toString("base64")}`;
  return `@font-face{font-family:'Montserrat';font-weight:100 900;font-style:normal;`
       + `src:url("${uri}") format('${fmt}');font-display:swap;}\n`;
}

/**
 * Кит одной строкой CSS: иконки встроены, семь @font-face заменены на один
 * вариативный. `die` вызывается, если чего-то не хватает: документ с битой
 * картинкой выглядит нормально на моей машине и сломанным перед клиентом.
 */
export function inlinedKitCss({ die, warn = console.warn, fontFormat = "ttf" } = {}){
  const fail = die || (m => { console.error(m); process.exit(2); });
  const kit = asset("bitrix24-kit.css");
  if(!fs.existsSync(kit))
    fail("brand-assets: assets/bitrix24-kit.css is missing — the document would be unstyled.");
  let css = fs.readFileSync(kit, "utf8");
  css = css.replace(/url\("bitrix24-images\/icons\/([^"]+)"\)/g, (m, file) => {
    const uri = dataUri(asset(path.join("icons", file)));
    if(!uri) fail(`brand-assets: kit icon "${file}" is not vendored in assets/icons — `
                + `copy it from the kit before building, or the document loads a broken image.`);
    return `url("${uri}")`;
  });
  css = css.replace(/@font-face\s*\{[^}]*Montserrat[^}]*\}/g, "");
  return fontFaceCss({ warn, format: fontFormat }) + css;
}

/* Расширения кита (префикс b24x-). Кит трогать нельзя, поэтому всё своё живёт
   здесь — и в документ уезжает вместе с китом. */
export function brandExtCss(){
  const ext = path.join(REPO, "css", "brand-ext.css");
  return fs.existsSync(ext) ? fs.readFileSync(ext, "utf8") : "";
}
