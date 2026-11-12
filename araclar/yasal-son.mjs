// Yasal ve destek sayfalarının son işlemi (pipotr-icerik #22, #24; bulut turu 11 Kasım 2026).
// Üreticiler (ISPE: pipotr-app/scripts/yasal_sayfalar.py, PRS: araclar/prs-yasal.mjs) dil bloklarını üretir; bu adım metne dokunmadan:
//  #22  varsayılan dil (tr) JS olmadan görünür; <html lang>, <title> statik ve Türkçe; JS'siz tarayıcıda (noscript) bütün diller açılır,
//       dil düğmeleri gizlenir; sayfa başına tek <h1> (öbür dillerin başlığı role="heading" aria-level="1");
//       dil düğmeleri en az 44 px ve dar ekranda tek satır yatay kaydırma.
//  #24  satır içi olay işleyicisi (onclick) ve style="" kalkar; <head>'e karma tabanlı CSP meta etiketi (GitHub Pages başlık ayarlamaz).
// Kullanım: `node araclar/yasal-son.mjs` (ISPE kök sayfalarını yerinde işler), `--denetle` (işlenmiş ve güncel mi). PRS üreticisi bunu içe aktarır.
// Aynı girdiye iki kez uygulanırsa ikinci uygulama değişiklik yapmaz.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const VARSAYILAN = 'tr';
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const NOSCRIPT_CSS = '[data-l][hidden]{display:block}nav{display:none}';
const EK_CSS = 'nav{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}nav button{min-height:44px;padding:10px 14px;flex:none}.mt10{margin-top:10px}';

export function sonIsle(html) {
  if (html.includes('http-equiv="Content-Security-Policy"')) return html; // zaten işlenmiş
  let h = html.replaceAll('\r\n', '\n');
  const marka = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || '';

  // Tek h1: varsayılan dilin başlığı <h1 class="h1">, öbürleri başlık rolündeki div
  let trBaslik = '';
  h = h.replace(/<div data-l="([a-z]+)" hidden><h1>([\s\S]*?)<\/h1>/g, (_, d, t) => {
    if (d === VARSAYILAN) {
      trBaslik = t;
      return `<div data-l="${d}"><h1 class="h1">${t}</h1>`;
    }
    return `<div data-l="${d}" hidden><div class="h1" role="heading" aria-level="1">${t}</div>`;
  });
  if (!trBaslik) throw new Error('varsayılan dil başlığı bulunamadı');
  // Varsayılan dilin gövde blokları da görünür doğar
  h = h.replaceAll(`<div data-l="${VARSAYILAN}" hidden>`, `<div data-l="${VARSAYILAN}">`);

  h = h.replace('<html lang="en">', `<html lang="${VARSAYILAN}">`);
  h = h.replace(`<title>${marka}</title>`, `<title>${trBaslik} · ${marka}</title>`);

  // Satır içi işleyici ve stil yok (CSP)
  h = h.replace(/<button data-k="([a-z]+)" onclick="show\('\1'\)">/g, '<button type="button" data-k="$1">');
  h = h.replaceAll('<p class="mail" style="margin-top:10px">', '<p class="mail mt10">');
  if (/ on[a-z]+="| style="/.test(h)) throw new Error('satır içi işleyici ya da stil kaldı');

  // Stil: .h1 aynı görünür, düğmeler 44 px
  h = h.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/(^|\})h1\{/, '$1h1,.h1{')}${EK_CSS}</style>`);

  // Betik: başlık seçicisi .h1, düğmeler addEventListener ile
  h = h.replace(/<script>([\s\S]*?)<\/script>/, (_, js) => {
    const yeni = js
      .replace(`document.querySelector('[data-l="'+l+'"] h1')`, `document.querySelector('[data-l="'+l+'"] .h1')`)
      .replace(/show\(pick\(\)\);$/, "document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>show(b.dataset.k)));show(pick());");
    if (yeni === js || !yeni.includes('addEventListener')) throw new Error('betik beklenen biçimde değil');
    return `<script>${yeni}</script>`;
  });

  const css = h.match(/<style>([\s\S]*?)<\/style>/)[1];
  const js = h.match(/<script>([\s\S]*?)<\/script>/)[1];
  const csp = `default-src 'none'; script-src ${sha(js)}; style-src ${sha(css)} ${sha(NOSCRIPT_CSS)}; base-uri 'none'; form-action 'none'; object-src 'none'`;
  h = h.replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`,
  );
  h = h.replace('</head>', `<noscript><style>${NOSCRIPT_CSS}</style></noscript></head>`);
  return h;
}

/** Sayfa son işlenmiş ve kendi içinde tutarlı mı (tek h1, CSP karmaları gerçek içerikle aynı) */
export function denetle(html) {
  const sorun = [];
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) sorun.push(`h1 sayısı ${h1}`);
  if (!html.includes(`<html lang="${VARSAYILAN}">`)) sorun.push('html lang');
  if (!html.includes(`<div data-l="${VARSAYILAN}"><h1`)) sorun.push('varsayılan dil gizli');
  if (/ on[a-z]+="| style="/.test(html)) sorun.push('satır içi işleyici/stil');
  const meta = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
  if (!meta) sorun.push('CSP yok');
  else {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const k of [sha(css), sha(js), sha(NOSCRIPT_CSS)]) if (!meta.includes(k)) sorun.push(`CSP karması eksik ${k}`);
  }
  return sorun;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kontrol = process.argv.includes('--denetle');
  let hata = 0;
  for (const ad of ['destek', 'gizlilik', 'kosullar']) {
    const yol = new URL(`../${ad}.html`, import.meta.url);
    const eski = readFileSync(yol, 'utf8');
    if (kontrol) {
      const s = denetle(eski);
      if (s.length) { console.error(`${ad}.html: ${s.join(', ')}`); hata++; }
    } else writeFileSync(yol, sonIsle(eski));
  }
  if (hata) process.exit(1);
  console.log(kontrol ? 'ISPE yasal sayfaları işlenmiş ve tutarlı' : 'destek.html, gizlilik.html, kosullar.html işlendi');
}
