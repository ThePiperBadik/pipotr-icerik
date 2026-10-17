# pipotr-icerik

PipoTr mobil uygulamasının herkese açık içerik deposu.

- `gizlilik.html`, `kosullar.html`, `destek.html` — 8 dilde yasal ve destek sayfaları (GitHub Pages)
- `manifest.json`, `v*/<dil>/*.json` — uygulamanın indirdiği dil paketleri (jsDelivr üzerinden)
- `v2/tr/*.json` — Türkçe asıl veri (`pipotr-app` deposundaki `src/data/*.json` dosyalarının aynısı; ISPE uygulaması bunları kendi içinde taşır, IPC bu klasörden okur). `manifest.json`'a eklenmedi; ISPE'nin dil paketi akışı değişmez.
- `v3/<dil>/*.json` — `v2`'nin tarafsızlık süzgecinden geçmiş hâli (ThePiperBadik/ipc#840): satıcı sitelerine giden bağlantılar, satıcıyı anan kaynak satırları ve harman metinlerindeki tavsiye/övgü cümleleri çıkarıldı. Kurallar IPC deposundadır (`src/tools/ispe-hosts.txt` [satici], `ispe-neutral.mjs`); `pipotr-app` deposundaki `scripts/ispe_tarafsiz.mjs paket v3 v2` ile üretilir, elle düzenlenmez. `manifest.json` `surum` = `v3`: uygulamalar (eski sürümler dahil) yeni paketi bu klasörden indirir, önbellek anahtarı sürüm klasörü olduğu için eski önbellek kullanılmaz. `v2/` olduğu gibi kalır (IPC gece eşitlemesi `v2/tr`'yi okur); `v2` kaldırma IPC eşitlemesi `v3/tr`'ye taşındıktan sonradır.
