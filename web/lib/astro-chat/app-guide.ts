// The app's own guide, for the assistant (offline and online): every menu and tab, what it shows
// and how to read it. Offline it answers "apa fungsi menu ETF?", "cara baca COT", "halaman ini apa";
// online the open page's entry and the ones a question names go to Claude with the question
// (guideFor), and the one-line index always does.

export type GuideEntry = {
  /** The view or tab it describes (store/terminal View or WidgetType). */
  id: string;
  title: string;
  /** Where it is in the menu. */
  where: string;
  /** The names a question calls it by (lowercase, whole words). */
  names: string[];
  /** What it shows, in a sentence or two. */
  what: string;
  /** How to read it. */
  read: string[];
};

export const GUIDE: GuideEntry[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    where: "Macro Command Center → Dashboard",
    names: ["dashboard", "dasbor", "halaman utama"],
    what: "Gambaran besar sebelum mencari ide trade: regime makro dan overlay risiko, pasar utama (hari/minggu/bulan), shortlist aset sesuai regime, kalender rilis berdampak tinggi 3 hari, breadth S&P 500, apa yang diperhitungkan futures, posisi COT yang crowded, tema geopolitik terhangat, dan kilat Watcher Guru. Tiap kotak adalah pintu ke menunya sendiri.",
    read: [
      "Mulai dari regime dan overlay risiko: itu konteks untuk semua kotak lain.",
      "Shortlist = aset yang bias regimenya dan trennya sejalan; itu kandidat, bukan sinyal beli.",
      "Kalender 3 hari: rilis berdampak tinggi bisa membalik gerak harga, jadi perhatikan sebelum membuka posisi.",
      "Posisi crowded (COT index ≥85 atau ≤15) adalah peringatan risiko pembalikan, bukan timing.",
      "Klik kotaknya untuk membuka detail di menunya.",
    ],
  },
  {
    id: "regime",
    title: "Macro Regime",
    where: "Macro Command Center → Macro Regime",
    names: ["macro regime", "regime", "regime makro", "kuadran"],
    what: "Kuadran pertumbuhan × inflasi sekarang (naik/turun masing-masing), peta kuadran, riwayat 36 bulan, overlay risiko (stres pasar), shortlist, dan bias tiap aset per regime: rata-rata return bulan berikutnya yang terukur sejak 2002, di samping arah yang lazim menurut teori.",
    read: [
      "Empat kuadran: pertumbuhan naik + inflasi naik (reflasi), pertumbuhan naik + inflasi turun (goldilocks), pertumbuhan turun + inflasi naik (stagflasi), pertumbuhan turun + inflasi turun (deflasi/perlambatan).",
      "Bias terukur lebih penting dari teori: lihat rata-rata return di regime sekarang, dan tanda t ≥ 2 yang berarti beda nyata dari bulan biasa aset itu.",
      "Overlay risiko yang tinggi bisa mengalahkan bias regime dalam jangka pendek.",
      "Regime dibaca dari data bulanan; ia berubah pelan dan bukan alat timing harian.",
    ],
  },
  {
    id: "market",
    title: "Market",
    where: "Macro Command Center → Market (tab Watchlist, Screener, Heatmap)",
    names: ["market", "menu market"],
    what: "Hub pasar dengan tiga tab: Watchlist (daftar pantauan dan pasar untuk dipilih), Screener (menyaring saham), dan Heatmap (peta warna pergerakan).",
    read: ["Pakai Watchlist untuk memantau, Screener untuk mencari kandidat, Heatmap untuk melihat sektor mana yang bergerak hari ini."],
  },
  {
    id: "watchlist",
    title: "Watchlist",
    where: "Market → Watchlist",
    names: ["watchlist", "daftar pantauan"],
    what: "Daftar pantauan dengan harga terakhir dan perubahan harian, dan di sampingnya pasar untuk dipilih dari satu dropdown: semua saham suatu bursa, indeks dunia per wilayah, semua koin kripto, dan pasangan forex.",
    read: [
      "Kolom Chg dan Chg% adalah perubahan sejak penutupan sebelumnya.",
      "Klik simbol untuk membukanya di Charting.",
      "Titik di samping simbol menandai pasarnya sedang buka.",
    ],
  },
  {
    id: "screener",
    title: "Screener",
    where: "Market → Screener",
    names: ["screener", "penyaring saham"],
    what: "Penyaring saham per sektor dengan perubahan harga atas periode yang dipilih, bisa diurutkan dan difilter.",
    read: ["Pilih periode perubahan (Chg over) dan sektor, lalu urutkan untuk menemukan yang paling kuat atau paling lemah. Kekuatan relatif adalah titik awal, bukan alasan membeli."],
  },
  {
    id: "heatmap",
    title: "Heatmap",
    where: "Market → Heatmap",
    names: ["heatmap", "peta panas", "peta warna"],
    what: "Peta kotak: tiap kotak satu saham atau aset, ukurannya menurut kapitalisasi (atau ukuran lain sesuai peta), warnanya menurut perubahan harga atas periode yang dipilih.",
    read: [
      "Hijau naik, merah turun; makin pekat makin besar geraknya. Batas warna penuh lebih lebar untuk periode yang lebih panjang.",
      "Kotak besar yang merah atau hijau menggerakkan indeks; banyak kotak kecil searah menunjukkan gerak yang luas (breadth).",
    ],
  },
  {
    id: "monetary",
    title: "Monetary Policy",
    where: "Policy & Expectations → Monetary Policy (tab Fed/FedWatch & data ekonomi, US Bonds)",
    names: ["monetary policy", "monetary", "kebijakan moneter", "moneter"],
    what: "Hub kebijakan moneter: tab kalender ekonomi, FedWatch, dan suku bunga pendanaan; tab US Bonds untuk kurva yield Treasury.",
    read: ["Ekspektasi suku bunga menggerakkan dolar, yield, emas, saham, dan kripto; lihat FedWatch untuk apa yang sudah diperhitungkan pasar sebelum rilis atau FOMC."],
  },
  {
    id: "calendar",
    title: "Fed, FedWatch & data ekonomi",
    where: "Monetary Policy → Fed, FedWatch & data ekonomi",
    names: ["fedwatch", "fed watch", "kalender ekonomi", "economic calendar", "data ekonomi", "kalender makro"],
    what: "Kalender ekonomi per hari dengan riwayat tiap rilis (aktual, perkiraan, sebelumnya, grafik dua tahun), headline makro kilat, FedWatch (peluang target suku bunga FOMC dari futures fed funds), dan suku bunga pendanaan semalam (SOFR, TGCR, BGCR, ON RRP). Tab kalender penuh punya filter negara dan minggu.",
    read: [
      "Kejutan = aktual dikurangi perkiraan. Data inflasi atau tenaga kerja yang lebih panas dari perkiraan cenderung hawkish (USD dan yield naik, emas/saham/kripto turun); lebih dingin sebaliknya.",
      "FedWatch: peluang tiap level suku bunga di rapat berikutnya. Perubahan peluang setelah rilis menunjukkan seberapa besar pasar mengubah ekspektasinya.",
      "Tanda petir menandai rilis berdampak besar.",
    ],
  },
  {
    id: "bonds",
    title: "US Bonds",
    where: "Monetary Policy → US Bonds",
    names: ["us bonds", "bonds", "obligasi", "treasury", "kurva yield", "yield curve"],
    what: "Kurva Treasury AS per tenor (US2Y, US10Y, US30Y lebih dulu), tiap tenor dengan jatuh tempo, kupon, dan lelang berikutnya dari surat acuannya, yield dan geraknya, kurva sekarang dibanding sebelumnya, dan spread.",
    read: [
      "Yield naik = harga obligasi turun. Yield 2 tahun mengikuti ekspektasi Fed; 10 dan 30 tahun memuat ekspektasi pertumbuhan, inflasi, dan premi risiko.",
      "Spread 10Y−2Y negatif (kurva terbalik) secara historis mendahului resesi, dengan jeda yang panjang dan tidak pasti.",
      "Lelang yang sepi peminat bisa mendorong yield tenor panjang naik.",
    ],
  },
  {
    id: "fiscal",
    title: "Fiscal Policy",
    where: "Policy & Expectations → Fiscal Policy",
    names: ["fiscal policy", "fiscal", "fiskal", "kebijakan fiskal", "tga", "defisit"],
    what: "Utang pemerintah AS, defisit anggaran bulanan (Monthly Treasury Statement), tekanan bunga (bunga atas utang yang dipegang publik dan rata-rata suku bunganya), dan kas Treasury di The Fed (TGA). Dari Fiscal Data API Treasury.",
    read: [
      "Defisit besar dibiayai dengan menerbitkan obligasi: pasokan yang deras cenderung menekan harga obligasi (yield naik), terutama tenor panjang.",
      "Porsi bunga terhadap penerimaan yang terus naik adalah ukuran tekanan fiskal: makin sensitif pasar terhadap berita fiskal (shutdown, plafon utang).",
      "TGA naik tajam menarik cadangan dari perbankan: likuiditas mengetat, sering berat bagi aset berisiko; TGA turun sebaliknya.",
    ],
  },
  {
    id: "futures",
    title: "Futures",
    where: "Policy & Expectations → Futures",
    names: ["futures", "kurva futures", "kurva forward", "contango", "backwardation"],
    what: "Harga forward: bulan-bulan kontrak tiap pasar dari depan ke belakang, bentuk kurvanya, carry per tahun yang tersirat, dan untuk pasar uang (SOFR, fed funds) jalur suku bunga yang diperhitungkan pasar dalam langkah 25 bp.",
    read: [
      "Contango (kontrak belakang lebih mahal) wajar untuk komoditas yang ada biaya simpannya; backwardation (kontrak depan lebih mahal) menandai pasokan ketat sekarang.",
      "Carry per tahun: berapa persen yang 'dibayar' atau 'diterima' pemegang posisi dari bentuk kurva.",
      "Untuk SOFR/fed funds: jumlah langkah 25 bp menunjukkan berapa kali pemangkasan atau kenaikan yang sudah diperhitungkan pasar.",
    ],
  },
  {
    id: "etf",
    title: "ETF",
    where: "Flow & Participants → ETF",
    names: ["etf", "menu etf", "rotasi sektor", "peta rotasi"],
    what: "Papan ETF utama AS per tema dengan gerak dan volume relatifnya, kinerja 1 dan 3 bulan dikurangi SPY, peta rotasi sektor terhadap S&P 500, breadth S&P 500 per sektor, dan arus harian ETF kripto spot AS.",
    read: [
      "Peta rotasi: sumbu x = unggul/tertinggal dari SPY selama 3 bulan (pp), sumbu y = percepatan bulan ini. Kanan-atas memimpin dan makin kuat, kanan-bawah memimpin tapi melambat, kiri-bawah tertinggal, kiri-atas tertinggal tapi membaik.",
      "Volume relatif tinggi menunjukkan perhatian besar pada ETF itu hari ini.",
      "Arus ETF kripto spot: inflow bersih berarti dana masuk ke bitcoin/ether lewat ETF; arus besar beruntun lebih berarti daripada satu hari.",
    ],
  },
  {
    id: "participants",
    title: "Market Participant",
    where: "Flow & Participants → Market Participant (tab Positioning COT, Money Flow, Insider)",
    names: ["market participant", "participant", "partisipan pasar"],
    what: "Hub siapa yang menggerakkan uang: posisi spekulan di futures (COT), arus beli/jual aset yang dibuka (Money Flow), dan unggahan orang dalam serta transaksi insider perusahaan (Insider).",
    read: ["Pakai untuk mengecek apakah sebuah gerak didukung uang besar atau sudah terlalu ramai di satu sisi."],
  },
  {
    id: "cot",
    title: "Positioning (COT)",
    where: "Market Participant → Positioning (COT)",
    names: ["cot", "positioning", "commitments of traders", "cot index"],
    what: "Laporan Commitments of Traders CFTC untuk 25 pasar futures: posisi bersih spekulan (leveraged funds untuk keuangan, managed money untuk komoditas), pemegang besar lain, dan hedger, perubahan minggu ini, dan COT index (0–100 dalam rentang 3 tahun).",
    read: [
      "COT index 100 = spekulan paling long dalam 3 tahun, 0 = paling short. ≥85 atau ≤15 berarti sisi itu ramai (crowded): sedikit pembeli/penjual baru tersisa, pembalikan bisa tajam.",
      "Hedger berposisi melindungi bisnis, biasanya berlawanan dengan harga; mereka bukan sinyal arah jangka pendek.",
      "Crowding adalah peringatan risiko, bukan timing: posisi bisa ekstrem berminggu-minggu selama tren berjalan.",
      "Data per Selasa, terbit Jumat sore waktu AS: selalu tertinggal sekitar 3 hari.",
    ],
  },
  {
    id: "moneyflow",
    title: "Money Flow",
    where: "Market Participant → Money Flow",
    names: ["money flow", "moneyflow", "arus uang", "aliran dana", "inflow", "outflow"],
    what: "Apa yang masuk dan keluar dari aset yang sedang dibuka selama sehari, seminggu, sebulan, 3 bulan, dan setahun: koin di Binance dari transaksi nyata (pembeli vs penjual), aset lain diperkirakan dari bar harganya. Tab lainnya daftar transaksi, dari siapa ke siapa.",
    read: [
      "Inflow lebih besar dari outflow = tekanan beli dominan pada periode itu; perhatikan apakah arah arus sejalan dengan arah harga.",
      "Untuk selain koin Binance angkanya perkiraan dari bar, jadi baca sebagai arah, bukan angka pasti.",
    ],
  },
  {
    id: "insider",
    title: "Insider",
    where: "Market Participant → Insider",
    names: ["insider", "orang dalam", "form 4", "pop-up whale", "whale"],
    what: "Unggahan akun-akun yang menggerakkan pasar, masing-masing dengan cara identitas penulisnya dikenali dan apakah media sudah memberitakannya; tab transaksi insider perusahaan dari laporan SEC Form 4. Tombol 'Hanya [pair]' menyaring yang berkaitan dengan pair yang dibuka; pop-up whale menampilkan pembelian/penjualan besar whale dan institusi untuk pair itu.",
    read: [
      "'Sumber resmi' = akun lembaga atau perusahaan itu sendiri; 'pernyataan langsung' = opini pemilik akun; 'belum dikonfirmasi' = kabar peristiwa yang belum diberitakan media resmi: belum tentu hoaks, tapi belum terbukti.",
      "Form 4: pembelian insider dengan uang sendiri lebih bermakna daripada penjualan (yang sering untuk pajak atau diversifikasi).",
      "Pop-up whale hilang sendiri setelah 3 detik; bisa dimatikan di tab ini.",
    ],
  },
  {
    id: "intel",
    title: "Market Intelligence",
    where: "Intelligence & Risk → Market Intelligence (tab News, Watcher Guru, Live TV & Fed)",
    names: ["market intelligence", "intelligence", "intel"],
    what: "Hub berita dan katalis: wire berita, kilat Watcher Guru, dan siaran TV bisnis live serta The Fed.",
    read: ["Pisahkan berita yang menggerakkan pasar (bertanda dampak) dari kebisingan; cek apakah harga bereaksi."],
  },
  {
    id: "news",
    title: "News",
    where: "Market Intelligence → News",
    names: ["news", "berita", "wire berita", "news recap"],
    what: "Semua tampilan berita: wire live, berita simbol yang dibuka, rekap berita harian/mingguan per sektor, dan hari pasar. Headline yang menggerakkan pasar ditandai 'DAMPAK BESAR' atau 'DAMPAK' dengan pasar yang terdampak.",
    read: [
      "Filter 'DAMPAK BESAR' menampilkan hanya headline yang biasanya menggerakkan pasar.",
      "Headline baru disorot sebentar saat masuk.",
      "Berita penting yang tidak menggerakkan harga sering berarti sudah diperhitungkan.",
    ],
  },
  {
    id: "watcher",
    title: "Watcher Guru",
    where: "Market Intelligence → Watcher Guru",
    names: ["watcher guru", "watcher", "telegram"],
    what: "Kilat 'JUST IN' dari kanal Telegram Watcher Guru, atau artikel situsnya per bagian atau pencarian.",
    read: ["Kilat sangat cepat tapi singkat; cek sumber aslinya sebelum bertindak, terutama untuk kabar yang belum dikonfirmasi media lain."],
  },
  {
    id: "tv",
    title: "Live TV & Fed",
    where: "Market Intelligence → Live TV & Fed",
    names: ["live tv", "tv", "siaran", "the fed live", "siaran fed", "konferensi pers fed"],
    what: "Kanal berita bisnis live, siaran The Fed saat ada (dengan transkrip dan penilaian nada hawkish/dovish), panel quant di sampingnya, rilis data AS berdampak besar, dan tab notifikasi Windows (siaran Fed live, pengingat ±3 jam sebelum rilis besar dengan skenario 30 menit pertama (untuk keputusan The Fed: skenario hawkish kuat/dovish kuat hari itu), H-30, hasil rilis, reaksi 5 menit).",
    read: [
      "Saat siaran Fed, ikon api = hawkish (lebih ketat dari perkiraan), kepingan salju = dovish, timbangan = netral; hitungan keduanya menunjukkan arah nada sejauh ini.",
      "Nada hawkish cenderung menaikkan USD dan yield, menekan emas, saham, dan kripto; dovish sebaliknya.",
    ],
  },
  {
    id: "geo",
    title: "Geopolitics",
    where: "Intelligence & Risk → Geopolitics",
    names: ["geopolitics", "geopolitik", "geo", "safe haven"],
    what: "Tema geopolitik yang ramai di berita dibanding minggu biasanya (7 hari vs rata-rata 4 minggu), nada eskalasi vs meredam, pengukur aset safe haven (emas, minyak, dolar, yield, saham, bitcoin, VIX), peta dampak teori tiap tema per aset dengan gerak nyata hari ini di baris bawah, dan kalender risiko 7 hari.",
    read: [
      "Tema yang jauh di atas rata-rata mingguannya sedang memanas; lihat apakah katanya cenderung eskalasi atau meredam.",
      "Peta dampak adalah arah lazim menurut teori; bandingkan dengan gerak nyata hari ini untuk melihat apakah pasar benar-benar bereaksi.",
      "Peringatan 'pola safe haven' muncul saat emas dan VIX naik sementara saham turun: pasar sedang mencari perlindungan.",
    ],
  },
  {
    id: "quant",
    title: "Quantitative",
    where: "Analysis & Execution → Quantitative",
    names: ["quantitative", "quant", "kuantitatif", "model quant", "regresi", "nowcast", "engine rilis", "dampak berita", "reaksi siaran fed"],
    what: "Model-model aplikasi dalam satu tempat, per tab: Regresi multifaktor (sensitivitas pair di Charting terhadap S&P 500, dolar, yield, VIX, emas, minyak, bitcoin), Prakiraan aset (peluang naik 5/10/20 hari, rentang wajar, rekam jejak walk-forward), Engine rilis & nowcast (P10/P50/P90 rilis makro AS berikutnya vs konsensus, nowcast inflasi dan GDP), Dampak berita (seberapa besar pasar bergerak setelah jenis berita tertentu), dan Reaksi siaran Fed.",
    read: [
      "Prakiraan: peluang naik dekat 50% dan vonis 'Netral' berarti tidak ada keunggulan arah yang teruji. Rentang P10–P90 lebih berguna untuk mengukur risiko.",
      "Rekam jejak walk-forward: model hanya layak dipercaya bila akurasinya mengalahkan tebakan dasar; sejauh ini belum ada yang terbukti.",
      "Engine rilis: bila P50 jauh dari konsensus, ada peluang kejutan; panas = hawkish, dingin = dovish.",
      "Regresi: beta menunjukkan seberapa besar pair ikut bergerak bila faktornya bergerak 1%; R² rendah berarti faktor itu menjelaskan sedikit.",
      "Transformasi data (di tab Regresi): OLS dibandingkan dengan winsorize 1%/99%, robust Huber, dan WLS bobot volatilitas pada uji walk-forward yang sama; sebuah metode dinyatakan lebih baik hanya bila R² luar sampelnya ≥ 1 poin di atas OLS dan menang di sebagian besar lipatan. Bila lebih baik, betanya lebih mewakili hari biasa (hari ekstrem tidak menarik beta).",
      "Beta bergulir: beta tiap faktor pada jendela 120 hari (atau 52 minggu) yang bergeser; beta yang berubah jauh atau berbalik tanda berarti beta seluruh periode kurang mewakili keadaan sekarang.",
    ],
  },
  {
    id: "chart",
    title: "Charting",
    where: "Analysis & Execution → Charting",
    names: ["charting", "chart", "grafik", "indikator chart", "drawing", "gambar garis"],
    what: "Chart harga dengan pilihan interval, tipe (candles, bars, line, area), indikator (termasuk indikator komunitas dan astro), alat gambar (garis tren, level, dll.), pencarian simbol termasuk pasangan silang (mis. SOL-BTC), dan menu mata uang untuk mengonversi harga beserta gambar garisnya.",
    read: [
      "Panel atas: OHLC bar di bawah kursor; tiap indikator menampilkan nilainya di baris legendanya.",
      "Gambar garis tersimpan per simbol; ikon pengaturan membuka setelan indikator atau gambar.",
      "Validasi ide di sini: lokasi harga terhadap support/resistance, tren, dan volume, bukan satu indikator saja.",
    ],
  },
  {
    id: "nodes",
    title: "Nodes Plan",
    where: "Analysis & Execution → Nodes Plan",
    names: ["nodes plan", "nodes", "rencana trade", "trade plan"],
    what: "Tesis yang diubah jadi rencana eksekusi dalam enam node: tesis, konteks dan katalis (dengan checklist), pemicu, eksekusi (entry, stop, target dengan reward-to-risk), risiko (ukuran posisi dari modal dan persen risiko, invalidasi), dan review (exit, hasil dalam R, pelajaran). Harga live dibandingkan dengan rencana.",
    read: [
      "Reward-to-risk (R) = jarak ke target dibagi jarak ke stop; di bawah 1,5 biasanya tidak layak kecuali peluang menangnya tinggi.",
      "Ukuran posisi dihitung dari risiko per trade (mis. 1% modal) dibagi jarak stop, bukan dari keyakinan.",
      "Invalidasi = kondisi yang membuat tesis salah; tulis sebelum entry.",
    ],
  },
  {
    id: "research",
    title: "Financials",
    where: "Fundamental Research & Learning → Financials",
    names: ["financials", "fundamental", "laporan keuangan", "research", "valuasi"],
    what: "Riset fundamental perusahaan: konsensus dan target harga analis, skor Piotroski, Altman, Beneish, nilai Graham, rasio valuasi (EV/EBITDA, margin bersih, dll.), dan peringatan data.",
    read: [
      "Piotroski 0–9: makin tinggi makin sehat fundamentalnya. Altman Z rendah = risiko kesulitan keuangan. Beneish tinggi = risiko manipulasi laba.",
      "Upside ke target analis atau nilai Graham adalah perkiraan, bukan janji; bandingkan dengan perusahaan sejenis.",
    ],
  },
  {
    id: "notepad",
    title: "Notepad",
    where: "Fundamental Research & Learning → Notepad",
    names: ["notepad", "catatan", "jurnal riset"],
    what: "Jurnal riset: catatan dengan simbol, tag, dan tautan ke rencana trade (jejak keputusan), dicari dan difilter per tag, dimulai dari template (jurnal harian, riset perusahaan, review trade, makro mingguan). Catatan bisa disematkan di atas.",
    read: ["Tulis alasan sebelum trade dan pelajaran sesudahnya; pola kesalahan baru terlihat setelah banyak catatan."],
  },
  {
    id: "academy",
    title: "Academy",
    where: "Fundamental Research & Learning → Academy",
    names: ["academy", "akademi", "pelajaran", "belajar"],
    what: "Pelajaran singkat mengikuti enam grup menu, masing-masing diakhiri dengan alat untuk praktik dan satu-dua soal; pelajaran yang sudah dibaca dicentang.",
    read: ["Ikuti urutannya dari Macro Command Center sampai Learning: urutan itu sama dengan alur kerja di menu."],
  },
  {
    id: "portfolio",
    title: "Portfolio",
    where: "Lainnya → Portfolio",
    names: ["portfolio", "portofolio", "jurnal trading", "trade journal"],
    what: "Jurnal trading: tiap trade dengan catatan sebelum dan sesudah, emosi sebelum/sesudah, foto chart (bisa ditempel), harga rata-rata, nilai pasar, PnL terealisasi dan belum terealisasi, dan impor XLSX.",
    read: ["Bandingkan emosi dan alasan sebelum trade dengan hasilnya: kebiasaan buruk (FOMO, balas dendam) terlihat dari pola, bukan satu trade."],
  },
  {
    id: "astrocal",
    title: "Astro Calendar",
    where: "Lainnya → Astro Calendar",
    names: ["astro calendar", "kalender astro", "kalender astrologi", "astrocal"],
    what: "Kejadian langit bulan ini (retrograde, gerhana, fase bulan, ingress, aspek) dengan prakiraan model quant untuk GOLD, BTC, dan DXY selama rentang kejadian: prakiraan sehari sebelumnya atau hari ini untuk yang akan datang, dan hasilnya. Studi peristiwa astrologi ditampilkan sebagai pola historis.",
    read: [
      "Ikon matahari-bulan = gerhana matahari, bulan = gerhana bulan, lingkaran penuh = bulan baru, lingkaran kosong = purnama.",
      "Diuji, pola astrologi benar kira-kira sesering lempar koin; perlakukan sebagai konteks, bukan sinyal.",
      "Prakiraan arah GOLD/BTC/DXY tampil Netral selama belum ada model yang terbukti mengalahkan tebakan dasar di uji walk-forward (saat ini 0 dari 30 aset × horizon).",
      "Tab Skenario rilis (dan tanda rilis di tanggalnya): untuk tiap rilis besar AS 7 hari ke depan, median gerak tiap aset, di 30 menit pertama setelah rilis atau sepanjang hari rilis (tombolnya bisa dipilih), setelah rilis-rilis sebelumnya dengan kejutan dingin kuat sampai panas kuat, rentang P10–P90 di tooltip, dan seberapa sering arahnya benar. Di tab yang sama ada kartu keputusan suku bunga The Fed (FOMC): jadwal rapat berikutnya, peluang FedWatch, dan gerak tiap aset setelah rapat-rapat sejak 2016 yang dibaca pasar dovish kuat, dovish, netral, hawkish atau hawkish kuat (dari gerak yield 2 tahun, karena keputusan suku bunganya hampir selalu sesuai konsensus), plus seberapa sering tiap aset ikut arah 2Y. Itu skenario, bukan ramalan: kejutannya baru diketahui saat rilis.",
    ],
  },
  {
    id: "ai",
    title: "AI Assist",
    where: "Lainnya → AI Assist",
    names: ["ai assist", "ai widget"],
    what: "Obrolan AI dengan konteks simbol yang aktif dan harganya; percakapan tersimpan bersama widget (100 pesan terakhir).",
    read: ["Untuk diskusi dengan data aplikasi, suara, dan melihat layar, pakai Asisten Astro (gelembung di pojok kanan bawah)."],
  },
  {
    id: "assistant",
    title: "Asisten Astro",
    where: "Gelembung di pojok kanan bawah",
    names: ["asisten astro", "asisten", "astro chat", "chat ini"],
    what: "Asisten yang menjawab dari data aplikasi: mode Claude (online, akun Claude Anda) atau Offline (hitungan aplikasi). Menu Claude berisi jawab dengan suara, tanya dengan suara (mode percakapan), lihat layar setiap bertanya, dan suara ElevenLabs.",
    read: [
      "Balas sebuah pesan untuk melanjutkan topiknya; pesan tanpa membalas dianggap topik baru.",
      "Tombol Dengar/Berhenti/Lanjut di bawah jawaban membacakan, menghentikan, dan melanjutkan dari titik berhenti.",
      "Saat asisten bicara, bilang 'tunggu' atau 'stop' untuk menyela, atau klik label asisten.",
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s&-]/gu, " ").replace(/\s+/g, " ").trim();
const has = (text: string, name: string) => new RegExp(`(^| )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);

/** The entries a question names, longest name first; a name inside a longer one that also matched ("market" in "market participant") doesn't count. */
export function guideEntries(question: string): GuideEntry[] {
  const q = norm(question);
  const matched = GUIDE.map((g) => ({ g, name: g.names.filter((n) => has(q, n)).sort((a, b) => b.length - a.length)[0] ?? "" })).filter((x) => x.name);
  return matched
    .filter((x) => !matched.some((y) => y !== x && y.name.length > x.name.length && y.name.includes(x.name)))
    .sort((a, b) => b.name.length - a.name.length)
    .map((x) => x.g);
}

export const guideById = (id: string) => GUIDE.find((g) => g.id === id) ?? null;

/** Whether a question is about the app itself (a menu, a tab, how to read or use something). */
export const ASKS_GUIDE = /\b(menu|halaman|tab|fitur|page|panel|tombol|cara (baca|membaca|pakai|memakai|menggunakan|pakainya)|fungsi|kegunaan|gunanya|isinya|ini apa|apa ini|maksud (halaman|menu|tab|angka|grafik))\b/;
/** Whether it asks about the page open now ("halaman ini", "menu ini"). */
export const ASKS_THIS_PAGE = /\b(halaman|menu|tab|page|layar|panel|grafik|chart) ini\b|\bini (apa|halaman apa|menu apa|maksudnya|gimana bacanya|cara bacanya)\b/;
/** Whether it asks for the list of menus. */
export const ASKS_MENU_LIST = /\b(menu|fitur|halaman) (apa saja|apa aja|yang ada|aplikasi)\b|\bdaftar (menu|fitur)\b|\bfitur aplikasi\b/;

/** One entry as an answer: what it shows and how to read it. */
export const guideText = (g: GuideEntry) => `**${g.title}** (${g.where})\n${g.what}\n\nCara membaca:\n${g.read.map((r) => `• ${r}`).join("\n")}`;

/** Every menu in a line, in the menu's order. */
export const guideIndex = () => GUIDE.map((g) => `• **${g.title}** (${g.where}): ${g.what.split(/(?<=\.)\s/)[0]}`).join("\n");

/**
 * The guide that goes with an online question: the one-line index always, and in full the page
 * open now and the ones the question names.
 */
export function guideFor(question: string, view: string | null): string {
  const entries = [...(view ? [guideById(view)].filter((g): g is GuideEntry => g !== null) : []), ...guideEntries(question)];
  const seen = new Set<string>();
  const full = entries.filter((g) => !seen.has(g.id) && seen.add(g.id)).slice(0, 4);
  return [`Halaman yang dibuka pengguna: ${view ? guideById(view)?.title ?? view : "(tidak diketahui)"}`, "Daftar menu:", guideIndex(), ...full.map(guideText)].join("\n\n");
}
