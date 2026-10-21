#!/usr/bin/env node
// Yazar, tarih, kaynak adresi ve lisans alanları (U-D3; ThePiperBadik/ipc#851 m.1–2, #853; sahip kararı 72: Pipedia atıf satırı açık).
// Bağımlılıksız Node (>= 20) + git. Çıktı: <surum>/atif.json (madde başına; dil paketlerine dokunmaz).
//
// Alanlar (madde başına):
//   yazar          "ISPE Editörlüğü" (her madde)
//   gozdenGeciren  yalnız sağlık / mevzuat maddelerinde; bugün kimse atanmadı → null (ad uydurulmaz; liste B'ye)
//   guncelleme     { <dil>: "YYYY-AA-GG" } 10 dilde: maddenin o dildeki metninin (başlık, özet, gövde, künye, kaynak; bağlantılar
//                  hariç) git geçmişinde son değiştiği commit günü. Depoya girdiğinden beri değişmediyse: Türkçede maddenin kendi
//                  tarihi (maddeler.json "g"), çeviride depoya giriş günü
//   kaynak         [{ metin, url? }] Türkçe kaynak satırları; url yalnız belirlenebildiğinde: satırdaki adres ya da satırın başındaki alan
//                  adı, IPC izin listesinde ([genel]) olan ve satıcı ([satici]) olmayan alan adıysa (#840)
//   lisans         Pipedia'yı kaynak gösteren maddede "CC BY-SA 3.0" (IPC #104 ile aynı; sürüm pipedia.org'dan bugün doğrulanamadı)
//   kaynakMadde    Pipedia satırından çıkarılan madde adı ve adresi (https://pipedia.org/wiki/<Ad>); adres doğrulanmadı → "dogrulanmadi": true
//
//   IPC_DIR=../ipc node araclar/atif.mjs            → <surum>/atif.json
//   IPC_DIR=../ipc node araclar/atif.mjs --denetle  → dosya güncel değilse 1
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DILLER = ['tr', 'en', 'de', 'fr', 'es', 'nl', 'sv', 'da', 'ja', 'zh'];
const YAZAR = 'ISPE Editörlüğü';
const LISANS = { ad: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/', not: 'IPC Okuma (#104) ile aynı sürüm; pipedia.org lisans sayfası 22 Ekim 2026\'da erişilemedi (403), sürüm buradan doğrulanmadı (tahmin)' };
const SAGLIK_MEVZUAT = /sağlık|nikotin|mevzuat|düzenleme|yasal/i; // Türkçe etiket (maddeler.json "t")

const oku = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const surum = oku(path.join(KOK, 'manifest.json')).surum;
const KLASOR = path.join(KOK, surum);
const icerikDosyalari = fs.readdirSync(path.join(KLASOR, 'tr')).filter((f) => /^icerik-.*\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
const git = (...a) => execFileSync('git', a, { cwd: KOK, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });

// ---- IPC izin listesi (#840 tek kaynak)
const ipc = process.env.IPC_DIR;
if (!ipc || !fs.existsSync(path.join(ipc, 'src', 'tools', 'ispe-guard.mjs'))) {
  console.error('[atif] IPC_DIR tanımlı değil ya da src/tools/ispe-guard.mjs yok (kaynak adresleri IPC izin listesiyle süzülür). Örnek: IPC_DIR=../ipc node araclar/atif.mjs');
  process.exit(2);
}
const guard = await import(pathToFileURL(path.join(ipc, 'src', 'tools', 'ispe-guard.mjs')).href);
const hosts = guard.ispeHosts();

// ---- metin özeti (bağlantılar hariç): içerik değişti mi
function metinIzi(...v) {
  const out = [];
  const gez = (x, k) => {
    if (k === 'l') return;
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach((y) => gez(y));
    else if (x && typeof x === 'object') for (const [kk, y] of Object.entries(x)) gez(y, kk);
  };
  v.forEach((x) => gez(x));
  return out.join(''); // ayraçsız: bağlantı için bölünen parça (U-D2) izi değiştirmez
}

/** Bir commit'te bir dilin madde → metin izi haritası (v2 ya da v3 klasörü) */
function izler(commit, dil) {
  const ls = git('ls-tree', '--name-only', commit, '--', `v2/${dil}/`, `v3/${dil}/`).split('\n').filter(Boolean);
  const klasor = ls.some((p) => p.startsWith('v3/')) ? 'v3' : ls.some((p) => p.startsWith('v2/')) ? 'v2' : null;
  if (!klasor) return null;
  const dosya = (ad) => (ls.includes(`${klasor}/${dil}/${ad}.json`) ? JSON.parse(git('show', `${commit}:${klasor}/${dil}/${ad}.json`)) : null);
  const bas = new Map();
  if (dil === 'tr') for (const m of dosya('maddeler') ?? []) bas.set(m.s, [m.b, m.z]);
  else for (const [s, m] of Object.entries(dosya('temel')?.madde ?? {})) bas.set(s, [m.b, m.z]);
  const out = new Map();
  for (const f of icerikDosyalari) {
    const v = dosya(f);
    if (!v) continue;
    for (const [s, x] of Object.entries(v)) out.set(s, metinIzi(bas.get(s), x));
  }
  return out;
}

function guncellemeler(dil, trTarih) {
  const commitler = git('log', '--reverse', '--format=%H %cs', '--', `v2/${dil}`, `v3/${dil}`).split('\n').filter(Boolean).map((l) => l.split(' '));
  const ilk = new Map();
  const son = new Map();
  let onceki = new Map();
  for (const [c, gun] of commitler) {
    const iz = izler(c, dil);
    if (!iz) continue;
    for (const [s, h] of iz) {
      if (!onceki.has(s)) ilk.set(s, gun);
      else if (onceki.get(s) !== h) son.set(s, gun);
    }
    onceki = iz;
  }
  // Çalışma kopyasındaki (commit'lenmemiş) değişiklik de sayılır: bugünkü dosya son commit'ten farklıysa bugün değil, betik
  // yalnız commit'lenmiş geçmişe bakar (belirlenimci çıktı)
  const t = new Map();
  for (const s of onceki.keys()) t.set(s, son.get(s) ?? (dil === 'tr' && trTarih.get(s) ? trTarih.get(s) : ilk.get(s)));
  return t;
}

// ---- kaynak satırları
const URL_RX = /https?:\/\/[^\s)]+/gi;
const BAS_ALAN = /^\s*([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/i;
function kaynakSatiri(metin) {
  const o = { metin };
  const u = (metin.match(URL_RX) || [])[0];
  if (u) { if (guard.ispeUrl(hosts, u) === 'ok') o.url = u; return o; }
  const m = metin.match(BAS_ALAN);
  if (m) {
    const adres = `https://${m[1].toLowerCase().replace(/^www\./, '')}`;
    if (guard.ispeUrl(hosts, adres) === 'ok') o.url = adres;
  }
  return o;
}
function pipediaMaddesi(metin) {
  const m = metin.match(/^\s*Pipedia\s*[—–-]\s*(.+?)\s*$/i);
  if (!m) return null;
  let ad = m[1].replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+(maddesi|maddeleri|bölümü|bahisleri|sayfası|kaydı|section)$/i, '').trim();
  if (!ad || /\s(ve|and)\s/.test(ad) && /maddeleri/i.test(m[1])) return { ad: m[1].trim(), url: 'https://pipedia.org', dogrulanmadi: true };
  return { ad, url: `https://pipedia.org/wiki/${encodeURIComponent(ad.replace(/ /g, '_')).replace(/%2F/g, '/')}`, dogrulanmadi: true };
}

// ---- üret
const trMaddeler = oku(path.join(KLASOR, 'tr', 'maddeler.json'));
const trTarih = new Map(trMaddeler.map((m) => [m.s, m.g]));
const trKaynak = new Map();
for (const f of icerikDosyalari) for (const [s, v] of Object.entries(oku(path.join(KLASOR, 'tr', `${f}.json`)))) trKaynak.set(s, Array.isArray(v.kaynak) ? v.kaynak.filter((x) => typeof x === 'string') : []);
const tarihler = Object.fromEntries(DILLER.map((d) => [d, guncellemeler(d, trTarih)]));

const maddeler = {};
const say = { madde: 0, yazar: 0, pipedia: 0, lisans: 0, kaynakSatiri: 0, kaynakUrl: 0, gozdenGecirenBos: [], guncellemeEksik: 0 };
for (const m of [...trMaddeler].sort((a, b) => (a.s < b.s ? -1 : 1))) {
  const s = m.s;
  const kaynak = (trKaynak.get(s) ?? []).map(kaynakSatiri);
  const o = { yazar: YAZAR };
  if ((m.t ?? []).some((x) => SAGLIK_MEVZUAT.test(x))) { o.gozdenGeciren = null; say.gozdenGecirenBos.push(s); }
  o.guncelleme = Object.fromEntries(DILLER.map((d) => [d, tarihler[d].get(s) ?? null]));
  say.guncellemeEksik += Object.values(o.guncelleme).filter((x) => !x).length;
  o.kaynak = kaynak;
  const pip = (trKaynak.get(s) ?? []).filter((x) => /pipedia/i.test(x));
  if (pip.length) {
    o.lisans = LISANS.ad;
    o.kaynakMadde = pip.map(pipediaMaddesi).filter(Boolean);
    say.pipedia++;
    say.lisans++;
  }
  say.madde++;
  say.yazar++;
  say.kaynakSatiri += kaynak.length;
  say.kaynakUrl += kaynak.filter((k) => k.url).length;
  maddeler[s] = o;
}

const sonuc = {
  surum,
  aciklama: 'U-D3 madde atıf alanları (ipc#851 m.1–2, #853; sahip kararı 72). Üreten: araclar/atif.mjs. Dil paketleri değişmez; site ve uygulama bu dosyayı madde anahtarıyla okur.',
  yazar: YAZAR,
  lisanslar: { [LISANS.ad]: { url: LISANS.url, not: LISANS.not } },
  atifSatiri: { tr: 'Kaynak: Pipedia, CC BY-SA lisansıyla uyarlanmıştır', not: 'Sahip kararı 72 (21 Ekim 2026). Diğer dillerdeki karşılık sitenin/uygulamanın arayüz metnidir.' },
  sayilar: say,
  maddeler,
};
const metin = JSON.stringify(sonuc, null, 1) + '\n';
const hedef = path.join(KLASOR, 'atif.json');
console.log(`[atif] ${say.madde} madde · yazar ${say.yazar} · Pipedia kaynaklı (lisans) ${say.lisans} · kaynak satırı ${say.kaynakSatiri} (adresli ${say.kaynakUrl}) · gözden geçiren bekleyen ${say.gozdenGecirenBos.length} · eksik tarih ${say.guncellemeEksik}`);
if (process.argv.includes('--denetle')) {
  const eski = fs.existsSync(hedef) ? fs.readFileSync(hedef, 'utf8').replace(/\r\n/g, '\n') : '';
  if (eski !== metin) { console.error(`[atif] ${surum}/atif.json güncel değil`); process.exit(1); }
  console.log(`[atif] ${surum}/atif.json güncel`);
} else {
  fs.writeFileSync(hedef, metin);
  console.log(`[atif] yazıldı: ${surum}/atif.json (${(metin.length / 1024).toFixed(0)} KB)`);
}
