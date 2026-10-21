#!/usr/bin/env node
// Madde içi bağlantılar (U-D2; ThePiperBadik/ipc#850 m.1 ve m.3). Bağımlılıksız Node (>= 20).
//
// Türkçe asıldaki her m:<hedef> bağlantısı için çeviri dilinde (9 dil) aynı maddenin gövdesinde (blokTam) hedefin o dildeki
// adı aranır ve ilk geçtiği yer bağlanır: { x: "...", l: "m:<hedef>" }. Metin karakterleri DEĞİŞMEZ (yalnız parça bölünür);
// betik her maddede bağlantı eklemeden önceki ve sonraki düz metni karşılaştırır, fark varsa durur.
//
// Aranan adlar, sırayla (uzun olan önce denenir):
//   1. hedef maddenin o dildeki başlığı (temel.json → madde.<hedef>.b), parantezsiz biçimi, parantez içi ve iki nokta öncesi
//   2. Türkçe bağlantı metni ya da hedefin Türkçe başlığı sözlükte bir terimse, o terimin o dildeki karşılığı (temel.json → soz)
//   3. Türkçe bağlantı metnindeki parantez içi yabancı terim (ör. "funda kökü (briar)" → "briar"; yalnız Latin yazılı dillerde)
// Eşleşme: Latin yazılı dillerde sözcük sınırıyla, büyük/küçük harf duyarsız, dilin çoğul/çekim eki kadar uzatılarak;
// ja/zh'de alt dizi. Başlık (h) ve tablo blokları ile zaten bağlı parçalar atlanır. Hedef başına bir bağlantı; kendine bağlantı
// ve hedefi olmayan (maddeler listesinde bulunmayan) bağlantı yazılmaz.
//
//   node araclar/baglanti.mjs           → v3/<dil>/icerik-*.json yazılır (bağlantılar baştan kurulur), özet basılır
//   node araclar/baglanti.mjs --kuru    → yalnız sayar
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CEVIRI = ['en', 'de', 'fr', 'es', 'nl', 'sv', 'da', 'ja', 'zh'];
const CJK = new Set(['ja', 'zh']);
const BILESIK = new Set(['de', 'nl', 'sv', 'da']);
// Çoğul ve sık çekim ekleri (bağlantı sözcüğün tamamını kapsasın: "briars", "Pfeifen")
const EK = { en: ['s', 'es'], de: ['e', 'en', 'er', 'es', 'n', 's'], fr: ['s', 'x'], es: ['s', 'es'], nl: ['en', 's', "'s"], sv: ['er', 'ar', 'en', 'na', 'n', 'erna', 'arna', 's'], da: ['er', 'e', 'en', 'ne', 'erne', 's'] };
const BAGLANABILIR = new Set(['p', 'li', 'oli']);
// Başlıktaki genel ad ("Talbert Pipes" → "Talbert", "Corncob Pipe" → "Corncob"): başlık yalnız "<ad> <genel>" ya da
// "<genel> <ad>" ise ve ad 1–2 sözcükse ad tek başına da aranır
const GENEL = { en: ['pipe', 'pipes'], de: ['pfeife', 'pfeifen'], fr: ['pipe', 'pipes'], es: ['pipa', 'pipas'], nl: ['pijp', 'pijpen'], sv: ['pipa', 'pipor'], da: ['pibe', 'piber'] };

const oku = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const surum = oku(path.join(KOK, 'manifest.json')).surum;
const KLASOR = path.join(KOK, surum);
const icerikDosyalari = fs.readdirSync(path.join(KLASOR, 'tr')).filter((f) => /^icerik-.*\.json$/.test(f)).sort();
const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const trKey = (s) => norm(s).toLocaleLowerCase('tr');

/** "Ad (Terim): Alt" → ["Ad (Terim): Alt", "Ad (Terim)", "Ad", "Terim"] */
function bicimler(ad) {
  const a = norm(ad);
  if (!a) return [];
  const out = new Set([a]);
  const ikiNokta = a.split(/\s*:\s+/)[0];
  out.add(ikiNokta);
  for (const x of [a, ikiNokta]) {
    const m = x.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (m) { out.add(norm(m[1])); out.add(norm(m[2])); }
  }
  return [...out].filter(Boolean);
}
const parantezIci = (s) => [...norm(s).matchAll(/\(([^()]+)\)/g)].map((m) => norm(m[1]));

function desen(dil, ad) {
  if (CJK.has(dil)) return ad.length >= 2 ? new RegExp(kacis(ad), 'u') : null;
  if (ad.length < 3) return null;
  // Bileşik sözcük dillerinde (de, nl, sv, da) tek sözcüklük ve en az 5 harflik ad bileşiğin başında da eşleşir (Morta → Mortapfeife)
  if (BILESIK.has(dil) && ad.length >= 5 && !/\s/.test(ad)) return new RegExp(`(?<![\\p{L}\\p{N}])${kacis(ad)}\\p{L}{0,14}(?![\\p{L}\\p{N}])`, 'iu');
  const ek = (EK[dil] ?? []).map(kacis).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])${kacis(ad)}(?:${ek})?(?![\\p{L}\\p{N}])`, 'iu');
}

const duzMetin = (bloklar) => bloklar.map((b) => (Array.isArray(b?.r) ? b.r.map((x) => x?.x ?? '').join('') : Array.isArray(b?.rows) ? b.rows.flat(2).join('\u0001') : '')).join('\u0002');

/** Bloklarda ilk eşleşmeyi bağlar; bulduysa true */
function bagla(bloklar, re, hedef) {
  for (const b of bloklar) {
    if (!b || !BAGLANABILIR.has(b.t) || !Array.isArray(b.r)) continue;
    for (let i = 0; i < b.r.length; i++) {
      const r = b.r[i];
      if (!r || typeof r.x !== 'string' || r.l) continue;
      const m = re.exec(r.x);
      if (!m || !m[0].trim()) continue;
      const { x, l, ...ek } = r;
      const parcalar = [];
      if (m.index > 0) parcalar.push({ ...ek, x: x.slice(0, m.index) });
      parcalar.push({ ...ek, x: m[0], l: `m:${hedef}` });
      if (m.index + m[0].length < x.length) parcalar.push({ ...ek, x: x.slice(m.index + m[0].length) });
      b.r.splice(i, 1, ...parcalar);
      return true;
    }
  }
  return false;
}

/** Önceki koşunun m: bağlantılarını kaldırır (yeniden koşu aynı sonucu versin): bağlantılı parça, aynı biçimli bağlantısız
 *  komşularıyla yeniden birleştirilir. Bağlantı olmayan yerde parçalara dokunulmaz */
const ayniBicim = (a, c) => !!a && !!c && typeof a.x === 'string' && typeof c.x === 'string' && !a.l && !c.l && (a.b ?? 0) === (c.b ?? 0) && (a.i ?? 0) === (c.i ?? 0);
function sifirla(bloklar) {
  for (const b of bloklar) {
    if (!Array.isArray(b?.r) || !b.r.some((r) => typeof r?.l === 'string' && r.l.startsWith('m:'))) continue;
    const yeni = [];
    let birlestir = false;
    for (const r of b.r) {
      const bagli = typeof r?.l === 'string' && r.l.startsWith('m:');
      const p = bagli ? (({ l, ...x }) => x)(r) : { ...r };
      const onceki = yeni[yeni.length - 1];
      if ((bagli || birlestir) && ayniBicim(onceki, p)) onceki.x += p.x;
      else yeni.push(p);
      birlestir = bagli;
    }
    b.r = yeni;
  }
}

const kuru = process.argv.includes('--kuru');
const trMaddeler = new Map(oku(path.join(KLASOR, 'tr', 'maddeler.json')).map((m) => [m.s, m]));
const trSozluk = oku(path.join(KLASOR, 'tr', 'sozluk.json'));
const sozlukTr = new Map();
for (const t of trSozluk) for (const b of bicimler(t.terim)) sozlukTr.set(trKey(b), t.id);

// #850 m.3: Türkçe asılda hedefi olmayan bağlantılar. Maddeler "briar" → "briyar" diye yeniden adlandırılmış, bağlantılar eski
// adda kalmış (m:briar, m:briarda-damar …): hedef yoksa ve "briyar"lı adı varsa bağlantı ona çevrilir. Başka hedefsiz
// bağlantıya dokunulmaz (kalite.json'da sayılır).
const eskiAd = (h) => (trMaddeler.has(h) ? h : trMaddeler.has(h.replace(/briar/g, 'briyar')) ? h.replace(/briar/g, 'briyar') : h);
let trDuzeltilen = 0;
for (const f of icerikDosyalari) {
  const p = path.join(KLASOR, 'tr', f);
  const veri = oku(p);
  let degisti = false;
  for (const v of Object.values(veri)) for (const b of v.blok ?? []) for (const r of b.r ?? []) {
    if (typeof r?.l !== 'string' || !r.l.startsWith('m:')) continue;
    const yeni = eskiAd(r.l.slice(2));
    if (yeni !== r.l.slice(2)) { r.l = `m:${yeni}`; trDuzeltilen++; degisti = true; }
  }
  if (degisti && !kuru) fs.writeFileSync(p, JSON.stringify(veri));
}
console.log(`[baglanti] tr: hedefi olmayan ${trDuzeltilen} bağlantı yeniden adlandırılan maddeye çevrildi`);

// Türkçe bağlantılar: madde → [{ hedef, metin }] (ilk geçiş sırası)
const trBag = new Map();
let trToplam = 0;
for (const f of icerikDosyalari) {
  for (const [s, v] of Object.entries(oku(path.join(KLASOR, 'tr', f)))) {
    const liste = [];
    const gor = new Set();
    for (const b of v.blok ?? []) for (const r of b.r ?? []) {
      if (typeof r?.l !== 'string' || !r.l.startsWith('m:')) continue;
      trToplam++;
      const h = eskiAd(r.l.slice(2));
      if (gor.has(h) || h === s || !trMaddeler.has(h)) continue;
      gor.add(h);
      liste.push({ hedef: h, metin: r.x });
    }
    trBag.set(s, liste);
  }
}

const trCift = [...trBag.values()].reduce((a, l) => a + l.length, 0);
const ozet = {};
for (const dil of CEVIRI) {
  const temel = oku(path.join(KLASOR, dil, 'temel.json'));
  const adlar = (h, metin) => {
    const out = new Set(bicimler(temel.madde[h]?.b));
    for (const b of [...out]) {
      const w = b.split(' ');
      const g = (x) => (GENEL[dil] ?? []).includes(x.toLocaleLowerCase(dil));
      if (w.length >= 2 && w.length <= 3 && g(w[w.length - 1]) && !w.slice(0, -1).some(g)) out.add(w.slice(0, -1).join(' '));
      if (w.length >= 2 && w.length <= 3 && g(w[0]) && !w.slice(1).some(g)) out.add(w.slice(1).join(' '));
    }
    for (const k of [...bicimler(metin), ...bicimler(trMaddeler.get(h)?.b)]) {
      const id = sozlukTr.get(trKey(k));
      if (id && temel.soz?.[id]?.terim) bicimler(temel.soz[id].terim).forEach((x) => out.add(x));
    }
    if (!CJK.has(dil)) parantezIci(metin).forEach((x) => out.add(x));
    return [...out].filter((x) => x.length >= (CJK.has(dil) ? 2 : 3)).sort((a, b) => b.length - a.length);
  };
  let eklenen = 0;
  for (const f of icerikDosyalari) {
    const p = path.join(KLASOR, dil, f);
    const veri = oku(p);
    for (const [s, v] of Object.entries(veri)) {
      const bloklar = v.blokTam ?? [];
      const once = duzMetin(bloklar);
      sifirla(bloklar);
      for (const { hedef, metin } of trBag.get(s) ?? []) {
        for (const ad of adlar(hedef, metin)) {
          const re = desen(dil, ad);
          if (re && bagla(bloklar, re, hedef)) { eklenen++; break; }
        }
      }
      if (duzMetin(bloklar) !== once) throw new Error(`${dil}/${f} ${s}: düz metin değişti`);
    }
    if (!kuru) fs.writeFileSync(p, JSON.stringify(veri));
  }
  ozet[dil] = { baglanti: eklenen, oran: Math.round((eklenen / trToplam) * 1000) / 10 };
  console.log(`[baglanti] ${dil}: ${eklenen} bağlantı (Türkçenin %${ozet[dil].oran}'i; Türkçe ${trToplam}, madde-hedef çifti ${trCift})`);
}
