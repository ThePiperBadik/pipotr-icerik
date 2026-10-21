#!/usr/bin/env node
// Aksansız sözcük düzeltmesi ve ölçümü, fr ve es (ThePiperBadik/ipc#525 kalanı; tur 11). Bağımlılıksız Node (>= 20).
//
// Liste: araclar/aksan-<dil>.tsv, satır başına "aksansız<TAB>doğru" (küçük harf). Listedeki aksansız biçim o dilde geçerli bir
// sözcük DEĞİLDİR (kesin hata); bağlama göre değişen çiftler (fr a/à, ou/où, -e/-é fiil biçimleri; es mas/más, el/él,
// esta/está, fabrica/fábrica, publico/público/publicó) listeye girmez, metinde olduğu gibi kalır. Anlam değişmez: yalnız
// aksan işareti eklenir, sözcük sırası ve başka harf değişmez (betik her metinde aksanları sildiğinde eski ve yeni metnin
// aynı kaldığını denetler, fark varsa durur).
//
// Uygulama: v3/<dil>/*.json içindeki metin değerleri (bağlantı hedefi l, blok türü t, kaynak satırı kaynak hariç). Tırnak
// ("…", “…”, «…») ve parantez içi atlanır: özgün ad, alıntı ve İngilizce terim orada durur.
//
//   node araclar/aksan.mjs              → v3/fr ve v3/es yazılır, özet basılır
//   node araclar/aksan.mjs --kuru       → yalnız sayar
//   node araclar/aksan.mjs --oner <dil>        → veriden liste önerisi basar (TSV, geçiş sayısıyla)
//   node araclar/aksan.mjs --oner <dil> --yaz  → araclar/aksan-<dil>.tsv yazar (düzeltmeden ÖNCEKİ veride koşulur)
//
// Öneri kuralı (--oner): aksanlı biçim en az 3 kez geçiyor ve tek biçim (%97); aksansız biçim aksanlı uzun metinlerde
// (>= 60 karakter, aksan içeren) seyrek (en çok 1 ya da aksanlı sayının %10'u; geçerli çiftlerde bu oran çok yüksektir:
// fr a/à %230, es esta/está %350); özel ad değil (büyük harfle başlayan geçiş çoğunlukta değil); fr'de yalnız sondaki é
// farkı (fiil biçimi: infuse/infusé, traites/traités) ve ELLE_HARIC'teki sözcükler girmez.
//
// Ölçüm (kalite.mjs de kullanır): kesin hata = listedeki aksansız sözcüklerin geçiş sayısı; uzun aksansız oranı = 120+
// karakterlik metinlerden hiç aksan içermeyenlerin oranı (harman açıklaması z ve madde metni ayrı; #525'in ölçüsü, bilgi);
// hatalı = bunlardan listeli sözcük içerenler. Geçme: kesin hata 0 ve hatalı oran < %3.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oku = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const surum = oku(path.join(KOK, 'manifest.json')).surum;
const KLASOR = path.join(KOK, surum);

export const AKSAN_DILLERI = ['fr', 'es'];
export const AKSAN_HEDEF = 0.03;
const AKSAN = { fr: /[éèêàâçùûîôëïüÿœÉÈÊÀÂÇÙÛÎÔËÏ]/u, es: /[áéíóúñüÁÉÍÓÚÑÜ]/u };
const HARIC = new Set(['l', 't', 'kaynak', 'url', 's', 'id']);
const KORUMA = /(“[^”]*”|"[^"]*"|«[^»]*»|\([^()]*\))/u;
const SOZCUK = /\p{L}+/gu;
const UZUN = 120;
// Elle çıkarılanlar: aksansız biçim de geçerli sözcük (ad, sıfat, fiil biçimi) ya da İngilizce; listeye girmez (21 Ekim 2026)
const ELLE_HARIC = {
  es: ['alejo', 'campanas', 'cana', 'cayo', 'cerro', 'continuo', 'critica', 'criticas', 'deposito', 'ejercito', 'escaneo', 'fabricas', 'frio', 'fumara', 'habito', 'inserto', 'iran', 'lamina', 'lena', 'limite', 'limites', 'medica', 'patina', 'practica', 'practicas', 'probo', 'publicas', 'rape', 'reparo', 'retiro', 'saco', 'sena', 'te', 'tomo', 'valida', 'varia'],
  fr: ['acre', 'cotes', 'mure', 'parente', 'rape', 'sure', 'these'],
};
const FIIL_ITE = /^(cit|invit|habit|imit|limit|visit|irrit|excit|incit|profit|edit|merit|felicit|hesit|recit|evit|sollicit|debit|herit|abrit|quitt|precipit|facilit|deshabit|transit|deposit|explicit|delimit|gravit|lévit|levit|trait|effrit|lit|ecrit|produit|reduit|construit|conduit|induit)es?$/;
const sil = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

export function listeOku(dil) {
  const p = path.join(KOK, 'araclar', `aksan-${dil}.tsv`);
  const m = new Map();
  if (!fs.existsSync(p)) return m;
  for (const satir of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = satir.trim();
    if (!t || t.startsWith('#')) continue;
    const [a, d] = t.split('\t');
    if (!a || !d || sil(d) !== a) throw new Error(`[aksan] aksan-${dil}.tsv bozuk satır: ${t}`);
    m.set(a, d);
  }
  return m;
}

/** Dosyadaki her metin değerini gezer; degistir verilirse yeni değeri yazar */
function gez(o, k, f) {
  if (typeof o === 'string') return HARIC.has(k) || /^(m:|https?:)/.test(o) ? o : f(o, k);
  if (Array.isArray(o)) return o.map((x) => gez(x, k, f));
  if (o && typeof o === 'object') {
    const y = {};
    for (const [kk, v] of Object.entries(o)) y[kk] = gez(v, kk, f);
    return y;
  }
  return o;
}

const buyukHarfle = (w, d) => (w.length > 1 && w === w.toUpperCase() ? d.toUpperCase() : w[0] !== w[0].toLowerCase() ? d[0].toUpperCase() + d.slice(1) : d);

/** Korunan bölümler (tırnak, parantez) dışında listedeki sözcükleri düzeltir */
export function duzelt(metin, liste, say) {
  return metin
    .split(KORUMA)
    .map((parca, i) =>
      i % 2 === 1
        ? parca
        : parca.replace(SOZCUK, (w) => {
            const d = liste.get(w.toLowerCase());
            if (!d) return w;
            if (say) say.n++;
            return buyukHarfle(w, d);
          }),
    )
    .join('');
}

const dosyalar = (dil) => fs.readdirSync(path.join(KLASOR, dil)).filter((f) => f.endsWith('.json')).sort();

/** Ölçüm: { kesinHata, harman: { uzun, aksansiz, oran }, madde: { … }, hedef, gecti } */
export function aksanOlc(dil, liste = listeOku(dil)) {
  const re = AKSAN[dil];
  const say = { kesinHata: 0, harman: { uzun: 0, aksansiz: 0, hatali: 0 }, madde: { uzun: 0, aksansiz: 0, hatali: 0 } };
  for (const f of dosyalar(dil)) {
    const tur = f === 'harmanlar.json' ? 'harman' : f.startsWith('icerik-') ? 'madde' : null;
    gez(oku(path.join(KLASOR, dil, f)), '', (s, k) => {
      let hata = 0;
      for (const w of s.split(KORUMA).filter((_, i) => i % 2 === 0).join(' ').match(SOZCUK) ?? []) if (liste.has(w.toLowerCase())) hata++;
      say.kesinHata += hata;
      if (tur && (tur === 'madde' ? k === 'x' : k === 'z') && s.length >= UZUN) {
        say[tur].uzun++;
        if (!re.test(s)) {
          say[tur].aksansiz++;
          if (hata) say[tur].hatali++;
        }
      }
      return s;
    });
  }
  const oran = (x) => ({ ...x, oran: Number((x.uzun ? x.aksansiz / x.uzun : 0).toFixed(4)) });
  const harman = oran(say.harman);
  const madde = oran(say.madde);
  // gecti: kesin hata yok ve hatalı (listeli sözcük içeren) uzun aksansız metin oranı hedefin altında. Ham "aksansiz" oranı
  // bilgi içindir: aksan gerektiren sözcük içermeyen doğru cümleler de ("No se ha encontrado una fuente fiable…") oraya girer.
  const hataliOran = (x) => (x.uzun ? x.hatali / x.uzun : 0);
  return { kesinHata: say.kesinHata, harman, madde, hedef: AKSAN_HEDEF, gecti: say.kesinHata === 0 && hataliOran(harman) < AKSAN_HEDEF && hataliOran(madde) < AKSAN_HEDEF };
}

function oner(dil) {
  const re = AKSAN[dil];
  const aksanli = new Map();
  const duz = new Map();
  const duzTemiz = new Map();
  const buyuk = new Map();
  const art = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const f of dosyalar(dil))
    gez(oku(path.join(KLASOR, dil, f)), '', (s) => {
      const temiz = s.length >= 60 && re.test(s);
      const duz_ = s.split(KORUMA).filter((_, i) => i % 2 === 0).join(' ');
      for (const m of duz_.matchAll(SOZCUK)) {
        const w = m[0];
        const k = w.toLowerCase();
        // Özel ad sayımı: cümle ya da metin başında olmayan büyük harfli geçiş (başlık ve tablo etiketi "Humidité" sayılmaz)
        const once = duz_.slice(0, m.index).trimEnd();
        if (w[0] !== k[0] && once && !/[.!?:;—–\-«"“(]$/.test(once)) art(buyuk, sil(k));
        if (re.test(k)) {
          const e = aksanli.get(sil(k)) ?? new Map();
          e.set(k, (e.get(k) ?? 0) + 1);
          aksanli.set(sil(k), e);
        } else {
          art(duz, k);
          if (temiz) art(duzTemiz, k);
        }
      }
      return s;
    });
  const out = [];
  for (const [a, e] of aksanli) {
    const hata = duz.get(a) ?? 0;
    if (!hata) continue;
    const top = [...e.values()].reduce((x, y) => x + y, 0);
    const [d, n] = [...e].sort((x, y) => y[1] - x[1])[0];
    if (top < 3 || n / top < 0.97) continue;
    if ((duzTemiz.get(a) ?? 0) > Math.max(1, 0.1 * top)) continue;
    if (ELLE_HARIC[dil].includes(a)) continue;
    if ((buyuk.get(a) ?? 0) * 2 >= hata + top) continue; // özel ad
    // fr yalnız sondaki é: fiil biçimi olabilir (infuse/infusé). İstisna -ité/-auté adları (qualité, humidité, communauté):
    // aksansız biçimleri fiil değildir; aynı biçimli -iter fiilleri (cite, invite, habite, limite…) FIIL_ITE'de
    if (dil === 'fr' && /és?$/.test(d) && !re.test(d.replace(/és?$/, '')) && !(/(it|aut)es?$/.test(a) && a.length >= 6 && !FIIL_ITE.test(a))) continue;
    out.push([a, d, hata]);
  }
  out.sort((x, y) => y[2] - x[2] || x[0].localeCompare(y[0]));
  return out;
}

const ana = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (ana) {
  const i = process.argv.indexOf('--oner');
  if (i > 0) {
    const dil = process.argv[i + 1];
    if (!AKSAN_DILLERI.includes(dil)) { console.error('[aksan] --oner fr|es'); process.exit(2); }
    const liste = oner(dil);
    if (process.argv.includes('--yaz')) {
      const bas = `# Aksansız biçimi kesin hata olan ${dil} sözcükleri (aksansız<TAB>doğru). Üreten: node araclar/aksan.mjs --oner ${dil} --yaz\n# (21 Ekim 2026, düzeltme öncesi v3 verisinden; kural aksan.mjs başında). Elle çıkarılanlar: ${ELLE_HARIC[dil].join(' ')}\n`;
      fs.writeFileSync(path.join(KOK, 'araclar', `aksan-${dil}.tsv`), bas + liste.map(([a, d]) => `${a}\t${d}`).sort().join('\n') + '\n');
      console.log(`[aksan] aksan-${dil}.tsv: ${liste.length} sözcük, ${liste.reduce((x, y) => x + y[2], 0)} geçiş`);
    } else for (const [a, d, n] of liste) console.log(`${a}\t${d}\t# ${n}`);
    process.exit(0);
  }
  const kuru = process.argv.includes('--kuru');
  for (const dil of AKSAN_DILLERI) {
    const liste = listeOku(dil);
    const say = { n: 0 };
    let dosya = 0;
    for (const f of dosyalar(dil)) {
      const p = path.join(KLASOR, dil, f);
      const ham = fs.readFileSync(p, 'utf8');
      const eski = JSON.parse(ham);
      const once = say.n;
      const yeni = gez(eski, '', (s) => {
        const y = duzelt(s, liste, say);
        if (sil(y) !== sil(s)) throw new Error(`[aksan] metin aksan dışında değişti (${dil}/${f}): ${s.slice(0, 80)}`);
        return y;
      });
      if (say.n > once) {
        dosya++;
        if (!kuru) fs.writeFileSync(p, JSON.stringify(yeni) + (ham.endsWith('\n') ? '\n' : ''));
      }
    }
    const o = kuru ? null : aksanOlc(dil, liste);
    console.log(`[aksan] ${dil}: liste ${liste.size} sözcük · düzeltilen ${say.n} geçiş, ${dosya} dosya${kuru ? ' (kuru)' : ''}${o ? ` · kalan kesin hata ${o.kesinHata} · uzun aksansız harman %${(o.harman.oran * 100).toFixed(1)} (${o.harman.aksansiz}/${o.harman.uzun}, hatalı ${o.harman.hatali}), madde %${(o.madde.oran * 100).toFixed(1)} (${o.madde.aksansiz}/${o.madde.uzun}, hatalı ${o.madde.hatali})` : ''}`);
  }
}
