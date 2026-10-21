#!/usr/bin/env node
// Ansiklopedi dil kalitesi ölçümü (U-D1; sahip kararı 71, 21 Ekim 2026). Bağımlılıksız Node (>= 20).
//
// Ne ölçer (dil ve madde başına, 1.236 madde × 10 dil):
//   kapsam      başlık, özet ve gövde dolu mu
//   sizinti     başlık/özet/gövdede Türkçe sızıntı: ğ ş ı İ harfli Latin sözcük (araclar/ozel-adlar.txt izin listesi dışı)
//               ya da araclar/turkce-sozcukler.txt listesindeki sözcük (yalnız çeviri dillerinde)
//   bos-blok    metni olmayan gövde bloğu
//   satici      tütün/pipo satıcısına giden bağlantı ya da satıcı alan adını anan kaynak satırı (#840; IPC [satici] listesi)
//   tavsiye     (gözden geçirilecek; kalıp yanlış eşleşebilir) tütün maddelerinde (icerik-tutunler, icerik-tutun-markalari) dilin kendi tavsiye/övgü kalıbına uyan birim
//               (#840 tarafsızlık kuralı, IPC ispe-neutral.mjs). Diğer maddelerde yalnız sayılır (bakım önerisi gibi bilgi
//               cümleleri kalıba uyar; neden sayılmaz)
//   baglanti    madde içi bağlantı (m:) sayısı, Türkçeye oranı ve hedefi olmayan bağlantı — bilgi, neden DEĞİL
//   ozet        özet sözcük sayısı (25 altı sayılır) — bilgi
//
// Sonuç: v3/kalite.json (manifest "surum" klasörüne). Karar 71: hiçbir dil ve madde noindex OLMAZ; ölçüyü geçemeyen
// madde dilin "duzeltilecek" listesine girer, bir dilde nedenli madde > %5 ise dil "duzeltilecek: true" olur.
// Çıktı belirlenimcidir (tarih ya da saat yazılmaz): aynı veri ve kurallarla iki koşu aynı dosyayı üretir.
//
// Kurallar IPC deposundan okunur, kopyalanmaz (#840 tek kaynak): IPC_DIR=<ipc klonu>.
//   IPC_DIR=../ipc node araclar/kalite.mjs              → v3/kalite.json yazar, özeti basar
//   IPC_DIR=../ipc node araclar/kalite.mjs --denetle    → yazmaz; dosya güncel değilse 1 ile çıkar
//   node araclar/kalite.mjs ozel-adlar                  → izin listesi önerisi (stdout; elle gözden geçirilip dosyaya yazılır)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DILLER = ['tr', 'en', 'de', 'fr', 'es', 'nl', 'sv', 'da', 'ja', 'zh'];
const TUTUN_DOSYALARI = new Set(['icerik-tutunler', 'icerik-tutun-markalari']);
const ESIK_DIL = 0.05; // nedenli madde oranı bunu aşarsa dil "duzeltilecek"
const KISA_OZET = 25; // sözcük

const oku = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const surum = (() => {
  const v = oku(path.join(KOK, 'manifest.json')).surum;
  if (typeof v !== 'string' || !/^v\d+$/.test(v)) throw new Error('manifest.json surum geçersiz');
  return v;
})();
const KLASOR = path.join(KOK, surum);
const icerikDosyalari = () => fs.readdirSync(path.join(KLASOR, 'tr')).filter((f) => /^icerik-.*\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();

// ---- metin yardımcıları
const TR_HARF = /[ğĞşŞıİ]/;
/** Latin yazılı sözcükler (CJK metin içindeki Latin sözcük de ayrı çıkar; kesme işareti sözcüğü böler: d'Eskişehir) */
const latinSozcukler = (s) => String(s ?? '').match(/[\p{Script=Latin}\p{M}]+/gu) || [];
const sozcukSayisi = (s, dil) => (dil === 'ja' || dil === 'zh' ? Math.ceil(String(s ?? '').replace(/\s/g, '').length / 2) : (String(s ?? '').match(/[\p{L}\p{N}]+/gu) || []).length);
const trKucuk = (s) => s.toLocaleLowerCase('tr');

/** Bloğun görünen metin parçaları: p/h/li/oli → r[].x, tbl → rows hücreleri */
function blokMetinleri(b) {
  if (!b || typeof b !== 'object') return [];
  if (Array.isArray(b.r)) return b.r.map((x) => (x && typeof x.x === 'string' ? x.x : '')).filter((x) => x !== '');
  if (Array.isArray(b.rows)) return b.rows.flat(2).filter((x) => typeof x === 'string');
  return [];
}
/** Bloktaki m: bağlantıları */
function blokBaglantilari(b, ekle) {
  const gez = (v) => {
    if (Array.isArray(v)) return v.forEach(gez);
    if (!v || typeof v !== 'object') return;
    if (typeof v.l === 'string') ekle(v.l);
    for (const [k, x] of Object.entries(v)) if (k !== 'l') gez(x);
  };
  gez(b);
}

// ---- izin listeleri (depoda, elle düzenlenir)
const listeOku = (ad) => {
  const p = path.join(KOK, 'araclar', ad);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
};

// ---- veri
function dilVerisi(dil) {
  const maddeler = new Map(); // s → { b, z, dosya, bloklar, kaynak }
  if (dil === 'tr') {
    for (const m of oku(path.join(KLASOR, 'tr', 'maddeler.json'))) maddeler.set(m.s, { b: m.b, z: m.z });
  } else {
    for (const [s, m] of Object.entries(oku(path.join(KLASOR, dil, 'temel.json')).madde)) maddeler.set(s, { b: m.b, z: m.z });
  }
  for (const f of icerikDosyalari()) {
    const p = path.join(KLASOR, dil, `${f}.json`);
    if (!fs.existsSync(p)) continue;
    for (const [s, v] of Object.entries(oku(p))) {
      const m = maddeler.get(s) ?? {};
      m.dosya = f;
      m.bloklar = (dil === 'tr' ? v.blok : v.blokTam) ?? [];
      m.kaynak = Array.isArray(v.kaynak) ? v.kaynak : [];
      maddeler.set(s, m);
    }
  }
  return maddeler;
}

// ---- ana ölçüm
async function kurallar() {
  const ipc = process.env.IPC_DIR;
  if (!ipc || !fs.existsSync(path.join(ipc, 'src', 'tools', 'ispe-guard.mjs'))) {
    console.error('[kalite] IPC_DIR tanımlı değil ya da src/tools/ispe-guard.mjs yok. Satıcı ve tavsiye kuralları IPC deposundan okunur (#840). Örnek: IPC_DIR=../ipc node araclar/kalite.mjs');
    process.exit(2);
  }
  const arac = (f) => import(pathToFileURL(path.join(ipc, 'src', 'tools', f)).href);
  const guard = await arac('ispe-guard.mjs');
  const notr = await arac('ispe-neutral.mjs');
  const hosts = guard.ispeHosts();
  if (!hosts.vendors?.size) { console.error('[kalite] ispe-hosts.txt [satici] bölümü boş'); process.exit(2); }
  const ozet = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ipc, 'src', 'tools', f))).digest('hex').slice(0, 12);
  return { guard, notr, hosts, iz: { 'ispe-hosts.txt': ozet('ispe-hosts.txt'), 'ispe-neutral.mjs': ozet('ispe-neutral.mjs'), 'ispe-guard.mjs': ozet('ispe-guard.mjs') } };
}

const URL_RX = /https?:\/\/[^\s)]+/gi;
const DOMAIN_RX = /(?<![\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w-])/gi;

export function olc({ guard, notr, hosts, iz }) {
  const ozelAdlar = listeOku('ozel-adlar.txt').map(trKucuk);
  const trSozcuk = new Set(listeOku('turkce-sozcukler.txt').map(trKucuk));
  const izinli = (w) => { const k = trKucuk(w); return ozelAdlar.some((a) => k.startsWith(a)); };
  const hk = (d) => d.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

  const tr = dilVerisi('tr');
  const sluglar = [...tr.keys()].sort();
  const trBaglanti = new Map();
  for (const s of sluglar) { let n = 0; for (const b of tr.get(s).bloklar ?? []) blokBaglantilari(b, (l) => { if (l.startsWith('m:')) n++; }); trBaglanti.set(s, n); }
  const trToplamBaglanti = [...trBaglanti.values()].reduce((a, b) => a + b, 0);

  const sonuc = {
    surum,
    aciklama: 'U-D1 dil kalitesi (sahip kararı 71): noindex YOK; nedenli maddeler dilin "duzeltilecekMaddeler" listesinde, nedenli madde oranı %5\'i aşan dil "duzeltilecek: true". Üreten: araclar/kalite.mjs.',
    kurallar: { esikDil: ESIK_DIL, kisaOzetSozcuk: KISA_OZET, nedenler: ['kapsam-baslik', 'kapsam-ozet', 'kapsam-govde', 'sizinti', 'bos-blok', 'satici', 'tavsiye'], ipcKurallari: iz, ozelAdlar: ozelAdlar.length, turkceSozcukler: trSozcuk.size },
    ozet: {},
    diller: {},
  };

  for (const dil of DILLER) {
    const veri = dil === 'tr' ? tr : dilVerisi(dil);
    const say = { madde: 0, nedenli: 0, kapsamEksik: 0, sizintiMadde: 0, baslikOzetTurkceHarf: 0, bosBlok: 0, satici: 0, tavsiyeTutun: 0, tavsiyeBilgi: 0, baglanti: 0, baglantiHedefsiz: 0, kisaOzet: 0 };
    const maddeler = {};
    const duzeltilecek = [];
    for (const s of sluglar) {
      const m = veri.get(s) ?? {};
      say.madde++;
      const nedenler = [];
      const ayrinti = {};
      const bloklar = Array.isArray(m.bloklar) ? m.bloklar : [];
      const govdeMetin = bloklar.flatMap(blokMetinleri).join(' ');
      if (!String(m.b ?? '').trim()) nedenler.push('kapsam-baslik');
      if (!String(m.z ?? '').trim()) nedenler.push('kapsam-ozet');
      if (!govdeMetin.trim()) nedenler.push('kapsam-govde');
      if (nedenler.length) say.kapsamEksik++;

      // Türkçe sızıntı (çeviri dillerinde)
      if (dil !== 'tr') {
        const bo = [...latinSozcukler(m.b), ...latinSozcukler(m.z)];
        if (bo.some((w) => TR_HARF.test(w))) say.baslikOzetTurkceHarf++;
        const sizan = new Set();
        for (const w of [...bo, ...latinSozcukler(govdeMetin)]) {
          if ((TR_HARF.test(w) && !izinli(w)) || (w === trKucuk(w) && trSozcuk.has(w))) sizan.add(w); // büyük harfli liste sözcüğü (Altınay Pipo) ad sayılır
        }
        if (sizan.size) { nedenler.push('sizinti'); ayrinti.sizinti = [...sizan].sort().slice(0, 12); say.sizintiMadde++; }
      }

      // boş blok
      const bos = bloklar.filter((b) => !blokMetinleri(b).join('').trim()).length;
      if (bos) { nedenler.push('bos-blok'); ayrinti.bosBlok = bos; say.bosBlok += bos; }

      // satıcı (#840): bağlantı ve kaynak satırı
      let sat = 0;
      for (const b of bloklar) blokBaglantilari(b, (l) => { if (/^\s*https?:/i.test(l) && guard.ispeUrl(hosts, l) === 'vend') sat++; });
      for (const k of m.kaynak ?? []) {
        if (typeof k !== 'string') continue;
        for (const u of k.match(URL_RX) || []) if (guard.ispeUrl(hosts, u) === 'vend') sat++;
        if ((k.replace(URL_RX, ' ').match(DOMAIN_RX) || []).some((d) => hosts.vendors.has(hk(d)))) sat++;
      }
      if (sat) { nedenler.push('satici'); ayrinti.satici = sat; say.satici += sat; }

      // tavsiye/övgü birimleri (dilin kendi kalıbı; ja/zh için IPC'de kural yok → sayılmaz)
      if (notr.NEUTRAL_RULES[dil]) {
        let tv = 0;
        for (const b of bloklar) if (b && (b.t === 'p' || b.t === 'li' || b.t === 'oli')) {
          for (const p of notr.ispeUnits(blokMetinleri(b).join(''))) for (const c of p) for (const u of c) if (notr.ispeFlag(dil, u, [m.b])) tv++;
        }
        if (tv) {
          if (TUTUN_DOSYALARI.has(m.dosya)) { nedenler.push('tavsiye'); ayrinti.tavsiye = tv; say.tavsiyeTutun += tv; } else say.tavsiyeBilgi += tv;
        }
      }

      // madde içi bağlantı (bilgi)
      let bag = 0;
      let hedefsiz = 0;
      for (const b of bloklar) blokBaglantilari(b, (l) => { if (l.startsWith('m:')) { bag++; if (!tr.has(l.slice(2))) hedefsiz++; } });
      say.baglanti += bag;
      say.baglantiHedefsiz += hedefsiz;
      if (hedefsiz) ayrinti.baglantiHedefsiz = hedefsiz;

      if (sozcukSayisi(m.z, dil) < KISA_OZET) say.kisaOzet++;

      if (nedenler.length) {
        say.nedenli++;
        duzeltilecek.push(s);
        maddeler[s] = { nedenler, ...ayrinti };
      }
    }
    const oran = say.madde ? say.nedenli / say.madde : 0;
    sonuc.diller[dil] = {
      acik: true, // karar 71: noindex yok
      duzeltilecek: oran > ESIK_DIL,
      nedenliOran: Math.round(oran * 10000) / 10000,
      baglantiOrani: trToplamBaglanti ? Math.round((say.baglanti / trToplamBaglanti) * 10000) / 10000 : 0,
      sayilar: say,
      duzeltilecekMaddeler: duzeltilecek,
      maddeler,
    };
    sonuc.ozet[dil] = `${say.nedenli}/${say.madde} nedenli (%${(oran * 100).toFixed(1)})${oran > ESIK_DIL ? ' → düzeltilecek' : ''} · sızıntı ${say.sizintiMadde} · başlık/özet TR harf ${say.baslikOzetTurkceHarf} · satıcı ${say.satici} · tavsiye (tütün) ${say.tavsiyeTutun} · bağlantı ${say.baglanti} (%${((say.baglanti / (trToplamBaglanti || 1)) * 100).toFixed(0)}) · kısa özet ${say.kisaOzet}`;
  }
  return sonuc;
}

// ---- izin listesi önerisi: Türkçe asıl gövdede cümle ortasında büyük harfle geçen (özel ad) ve ğ ş ı İ içeren sözcükler
function ozelAdOner() {
  const tr = dilVerisi('tr');
  const say = new Map();
  for (const m of tr.values()) {
    for (const b of m.bloklar ?? []) {
      if (b?.t === 'h') continue;
      for (const metin of blokMetinleri(b)) {
        const parcalar = metin.split(/(?<=[.!?…:])\s+/u);
        for (const p of parcalar) {
          const w = latinSozcukler(p);
          w.slice(1).forEach((x) => { if (TR_HARF.test(x) && /^\p{Lu}/u.test(x)) say.set(x, (say.get(x) ?? 0) + 1); });
        }
      }
    }
  }
  return [...say.entries()].filter(([, n]) => n >= 1).map(([w]) => w).sort((a, b) => a.localeCompare(b, 'tr'));
}

const arg = process.argv.slice(2);
if (arg[0] === 'ozel-adlar') {
  for (const w of ozelAdOner()) console.log(w);
} else {
  const sonuc = olc(await kurallar());
  const metin = JSON.stringify(sonuc, null, 1) + '\n';
  const hedef = path.join(KLASOR, 'kalite.json');
  for (const [d, o] of Object.entries(sonuc.ozet)) console.log(`[kalite] ${d}: ${o}`);
  if (arg.includes('--denetle')) {
    const eski = fs.existsSync(hedef) ? fs.readFileSync(hedef, 'utf8') : '';
    if (eski !== metin) { console.error(`[kalite] ${surum}/kalite.json güncel değil: IPC_DIR=../ipc node araclar/kalite.mjs`); process.exit(1); }
    console.log(`[kalite] ${surum}/kalite.json güncel`);
  } else {
    fs.writeFileSync(hedef, metin);
    console.log(`[kalite] yazıldı: ${surum}/kalite.json (${(metin.length / 1024).toFixed(0)} KB)`);
  }
}
