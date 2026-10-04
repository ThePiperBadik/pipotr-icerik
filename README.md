# pipotr-icerik

PipoTr mobil uygulamasının herkese açık içerik deposu.

- `gizlilik.html`, `kosullar.html`, `destek.html` — 8 dilde yasal ve destek sayfaları (GitHub Pages)
- `manifest.json`, `v*/<dil>/*.json` — uygulamanın indirdiği dil paketleri (jsDelivr üzerinden)
- `v2/tr/*.json` — Türkçe asıl veri (`pipotr-app` deposundaki `src/data/*.json` dosyalarının aynısı; ISPE uygulaması bunları kendi içinde taşır, IPC bu klasörden okur). `manifest.json`'a eklenmedi; ISPE'nin dil paketi akışı değişmez.
