// What the Astro Calendar's chat knows beyond the numbers: price action, financial astrology and
// what the research (and this app's own tests) found of it, the macro the markets move on, and how
// the app works. Each topic: a short answer, a deeper one ("kenapa?", "jelaskan lebih"), and the
// topics next to it. Matched by the words a question uses (keys, normalised as text.ts does).

export type Topic = { id: string; title: string; keys: string[]; body: string; deeper: string; related: string[] };

export const TOPICS: Topic[] = [
  // ---------------------------------------------------------------- price action
  {
    id: "support-resistance",
    title: "Support dan resistance",
    keys: ["support", "resistance", "resisten", "level kunci", "area harga", "supply demand", "supply", "demand"],
    body: "Support adalah area harga tempat pembeli berulang kali menahan penurunan; resistance adalah area tempat penjual berulang kali menahan kenaikan. Area itu terbentuk karena banyak pelaku mengingat harga yang sama: order tertumpuk, stop loss terkumpul, dan orang yang \"terjebak\" ingin keluar di harga modal. Semakin sering diuji dan semakin besar volume di sana, semakin penting levelnya, tapi juga semakin banyak stop di baliknya.",
    deeper: "Support yang tembus sering berubah peran menjadi resistance (polarity flip), karena pembeli yang tadi bertahan kini rugi dan ingin keluar di harga modal. Yang perlu diingat: level adalah zona, bukan garis; harga sering \"menusuk\" lalu kembali (stop hunt). Cara yang lebih objektif menandainya: titik balik ayunan (swing high/low), volume profile (area dengan transaksi terbanyak), dan angka bulat (2.000 untuk emas, 100.000 untuk BTC).",
    related: ["breakout", "trend-structure", "volume", "order-block"],
  },
  {
    id: "trend-structure",
    title: "Tren dan struktur pasar",
    keys: ["tren", "trend", "uptrend", "downtrend", "struktur pasar", "market structure", "higher high", "higher low", "lower high", "lower low", "hh", "hl", "sideways", "ranging"],
    body: "Tren naik adalah rangkaian puncak dan lembah yang makin tinggi (higher high, higher low); tren turun sebaliknya (lower high, lower low). Saat puncak dan lembah tidak membentuk arah, pasar sideways. Struktur ini lebih penting daripada indikator mana pun: indikator hanya merangkum harga yang sama.",
    deeper: "Perubahan struktur (break of structure / change of character) terjadi ketika lembah terakhir dalam tren naik ditembus ke bawah: tanda pertama tren mungkin berakhir, bukan kepastian. Secara statistik, tren di pasar komoditas dan mata uang cenderung berlanjut dalam jangka menengah (time-series momentum, Moskowitz, Ooi & Pedersen 2012), sedangkan dalam hitungan hari pergerakan lebih acak. Uji di aplikasi ini juga menemukan momentum 5–20 hari tidak cukup untuk menebak arah ke depan.",
    related: ["support-resistance", "moving-average", "momentum", "breakout"],
  },
  {
    id: "breakout",
    title: "Breakout dan false breakout",
    keys: ["breakout", "break out", "tembus", "false breakout", "fakeout", "fake out", "jebol", "retest"],
    body: "Breakout terjadi saat harga menembus support/resistance yang sudah lama bertahan. Breakout yang sehat biasanya disertai volume dan penutupan candle di luar level, lalu sering kembali menguji level itu (retest). False breakout: harga menembus sebentar lalu kembali ke dalam rentang, menjebak yang mengejar.",
    deeper: "False breakout sering terjadi karena stop loss yang menumpuk di balik level justru menjadi likuiditas bagi pelaku besar: pembelian dari stop short di atas resistance dipakai untuk menjual. Karena itu sebagian trader menunggu penutupan candle harian atau retest sebelum masuk. Tidak ada aturan yang selalu benar; yang bisa diukur adalah rasio keberhasilan di pasar dan timeframe tertentu.",
    related: ["support-resistance", "volume", "order-block", "risk"],
  },
  {
    id: "candlestick",
    title: "Pola candlestick",
    keys: ["candlestick", "candle", "pin bar", "pinbar", "engulfing", "doji", "hammer", "shooting star", "morning star", "evening star", "inside bar", "ekor candle", "wick", "sumbu"],
    body: "Candlestick merangkum harga pembukaan, tertinggi, terendah, dan penutupan satu periode. Pola populer: pin bar/hammer (ekor panjang: penolakan harga), engulfing (badan candle menelan candle sebelumnya: perubahan dominasi), doji (pembukaan ≈ penutupan: ragu-ragu), inside bar (rentang menyempit sebelum gerak).",
    deeper: "Pola candle paling berarti di lokasi penting (support/resistance, puncak tren), bukan di tengah rentang. Penelitian atas pola candle Jepang secara umum menemukan daya prediksinya lemah setelah biaya transaksi bila dipakai sendirian (mis. Marshall, Young & Rose 2006 pada saham AS). Gunakan sebagai konfirmasi konteks, bukan sinyal tunggal.",
    related: ["support-resistance", "trend-structure", "volume"],
  },
  {
    id: "volume",
    title: "Volume",
    keys: ["volume", "vol", "transaksi", "likuiditas", "liquidity", "volume profile", "vwap"],
    body: "Volume adalah banyaknya transaksi. Gerak harga dengan volume besar menunjukkan partisipasi luas; gerak dengan volume tipis lebih mudah berbalik. Volume profile menunjukkan di harga mana transaksi paling banyak terjadi (area nilai), yang sering menjadi magnet atau penahan harga.",
    deeper: "Untuk emas spot dan forex, volume yang terlihat di grafik biasanya tick volume (jumlah perubahan harga) dari satu broker, bukan volume pasar sebenarnya, karena pasarnya terdesentralisasi; futures (GC di COMEX) memberi volume resmi. Untuk BTC, volume tersebar di banyak bursa dan sebagian bisa wash trading. VWAP (harga rata-rata tertimbang volume) dipakai institusi sebagai patokan eksekusi harian.",
    related: ["support-resistance", "breakout", "order-block"],
  },
  {
    id: "order-block",
    title: "Order block dan likuiditas (konsep SMC)",
    keys: ["order block", "orderblock", "smc", "smart money", "fair value gap", "fvg", "imbalance", "liquidity sweep", "stop hunt", "ict"],
    body: "Order block adalah candle terakhir berlawanan arah sebelum gerak impulsif, dianggap jejak order besar yang belum selesai; fair value gap adalah celah harga yang terlewati cepat. Konsep \"smart money\" ini memandang pasar sebagai perburuan likuiditas: harga menyapu stop di atas puncak/bawah lembah sebelum bergerak sebenarnya.",
    deeper: "Gagasan dasarnya (order besar dieksekusi bertahap, stop loss berkumpul di level jelas) masuk akal, tapi banyak definisi SMC subjektif dan jarang diuji secara sistematis. Aplikasi ini punya indikator Order Block Detector di chart; cara jujur memakainya adalah menghitung seberapa sering zona itu benar-benar menahan harga di aset dan timeframe Anda.",
    related: ["support-resistance", "breakout", "volume"],
  },
  {
    id: "moving-average",
    title: "Moving average, golden cross, death cross",
    keys: ["moving average", "ma 50", "ma 200", "ma50", "ma200", "ema", "sma", "rata-rata bergerak", "golden cross", "death cross"],
    body: "Moving average (MA) merata-ratakan harga beberapa hari terakhir untuk menghaluskan noise. Harga di atas MA 200 hari sering dianggap tren jangka panjang naik. Golden cross: MA 50 memotong MA 200 ke atas; death cross: ke bawah. EMA memberi bobot lebih ke harga terbaru.",
    deeper: "Persilangan MA selalu terlambat karena dihitung dari harga lalu: sinyalnya muncul setelah sebagian besar gerak terjadi. Strategi trend-following berbasis MA cenderung untung di tren panjang dan rugi kecil berulang di pasar sideways. Model quant di aplikasi ini memakai jarak harga ke MA 50 dan 200 sebagai fitur; hasil ujinya: tidak cukup untuk menebak arah 5–20 hari.",
    related: ["trend-structure", "momentum", "indicators"],
  },
  {
    id: "indicators",
    title: "RSI, MACD, dan indikator lain",
    keys: ["rsi", "macd", "stochastic", "stoch", "indikator", "indicator", "overbought", "oversold", "jenuh beli", "jenuh jual", "divergence", "divergensi", "bollinger"],
    body: "RSI mengukur kecepatan kenaikan vs penurunan (di atas 70 disebut jenuh beli, di bawah 30 jenuh jual). MACD adalah selisih dua EMA untuk melihat momentum. Stochastic membandingkan penutupan dengan rentang terakhir. Bollinger Bands memberi pita 2 simpangan baku di sekitar MA.",
    deeper: "Semua indikator ini turunan dari harga yang sama, jadi sering memberi informasi berulang. \"Jenuh beli\" bisa bertahan lama dalam tren kuat; RSI lebih berguna untuk melihat divergensi (harga membuat puncak baru, RSI tidak). Uji sendiri di aset Anda sebelum mempercayainya: aplikasi ini menyediakan chart dengan 160+ indikator untuk itu.",
    related: ["moving-average", "momentum", "trend-structure"],
  },
  {
    id: "momentum",
    title: "Momentum vs mean reversion",
    keys: ["momentum", "mean reversion", "pembalikan", "reversal", "balik arah", "pantulan", "rebound"],
    body: "Momentum: aset yang naik cenderung terus naik untuk sementara. Mean reversion: gerak ekstrem cenderung kembali ke rata-rata. Keduanya bisa benar pada skala waktu berbeda: dalam hitungan hari sering ada pembalikan kecil, dalam hitungan bulan sering ada kelanjutan tren.",
    deeper: "Bukti akademik: momentum lintas aset dalam 3–12 bulan (Jegadeesh & Titman 1993 untuk saham; Moskowitz, Ooi & Pedersen 2012 untuk futures), pembalikan jangka pendek dalam hitungan minggu, dan pembalikan jangka panjang 3–5 tahun. Efeknya kecil dan tidak stabil; bisa hilang bertahun-tahun.",
    related: ["trend-structure", "volatility", "indicators"],
  },
  {
    id: "volatility",
    title: "Volatilitas dan ATR",
    keys: ["volatilitas", "volatility", "atr", "average true range", "simpangan baku", "standard deviation", "fluktuasi", "vix", "rentang harian"],
    body: "Volatilitas adalah seberapa besar harga biasanya bergerak. Diukur dengan simpangan baku return harian (biasanya disetahunkan: ×√252, atau ×√365 untuk kripto) atau ATR (rata-rata rentang harian). Volatilitas cenderung mengelompok: hari bergejolak diikuti hari bergejolak.",
    deeper: "Volatilitas lebih mudah ditebak daripada arah, dan itu terlihat di aplikasi ini: rentang wajar P10–P90 dari model quant lebih baik daripada rentang biasa di 27 dari 30 pasar, sedangkan tebakan arahnya 0 dari 30. Hari rilis CPI, NFP, ISM, dan FOMC biasanya menaikkan volatilitas emas, dolar, dan yield. Pakai volatilitas untuk menentukan besar posisi dan jarak stop loss.",
    related: ["risk", "drawdown", "macro-releases"],
  },
  {
    id: "drawdown",
    title: "Drawdown",
    keys: ["drawdown", "penurunan dari puncak", "max drawdown", "mdd", "koreksi"],
    body: "Drawdown adalah penurunan dari puncak tertinggi sebelumnya ke titik terendah sesudahnya, dalam persen. Max drawdown adalah drawdown terbesar dalam suatu periode. Ini ukuran rasa sakit terburuk yang dialami pemegang aset.",
    deeper: "Contoh skala: emas pernah turun sekitar 45% dari puncak 2011 ke dasar 2015; BTC berkali-kali turun lebih dari 75% (2014–15, 2018, 2022). Pemulihan drawdown butuh kenaikan yang lebih besar: turun 50% butuh naik 100% untuk kembali. Tanyakan \"drawdown terbesar emas 2022\" untuk angka dari data aplikasi.",
    related: ["volatility", "risk"],
  },
  {
    id: "risk",
    title: "Manajemen risiko",
    keys: ["manajemen risiko", "risk management", "stop loss", "sl", "take profit", "tp", "position sizing", "ukuran posisi", "risk reward", "rr", "money management", "leverage", "margin call"],
    body: "Inti manajemen risiko: tentukan dulu berapa yang rela hilang per posisi (mis. 1% modal), lalu ukuran posisi = risiko ÷ jarak stop loss. Rasio risk-reward membandingkan potensi rugi dan untung; dengan RR 1:2, Anda cukup benar sekitar 34% (di luar biaya) untuk impas.",
    deeper: "Leverage memperbesar untung dan rugi; dengan leverage tinggi, gerak normal sehari (lihat volatilitas) bisa menghapus akun. Hal yang sering dilupakan: rentetan kekalahan itu normal. Dengan peluang menang 50%, kalah 6 kali beruntun dalam 100 posisi hampir pasti terjadi. Aplikasi ini tidak memberi saran investasi; angka-angka di sini untuk memahami pasar, bukan perintah beli/jual.",
    related: ["volatility", "drawdown", "breakout"],
  },
  {
    id: "sessions",
    title: "Sesi pasar (Asia, London, New York)",
    keys: ["sesi", "session", "sesi asia", "sesi london", "sesi new york", "jam pasar", "jam buka", "market hours", "overlap"],
    body: "Forex dan emas diperdagangkan hampir 24 jam: sesi Asia (Tokyo, Sydney), London (sekitar 14.00–23.00 WIB), dan New York (sekitar 19.00–04.00 WIB). Volume dan volatilitas biasanya tertinggi saat London dan New York tumpang tindih (sekitar 19.00–23.00 WIB). Rilis data AS umumnya pukul 19.30 atau 20.30 WIB, keputusan FOMC pukul 01.00 atau 02.00 WIB.",
    deeper: "Jam di atas bergeser satu jam saat AS/Eropa berganti waktu musim panas (Maret dan Oktober/November). BTC diperdagangkan 24/7, tapi volumenya juga paling besar saat jam kerja AS. Di aplikasi ini, jam dunia di bagian atas layar menunjukkan bursa yang sedang buka.",
    related: ["macro-releases", "volatility"],
  },

  // ---------------------------------------------------------------- financial astrology
  {
    id: "financial-astrology",
    title: "Astrologi keuangan (financial astrology)",
    keys: ["astrologi keuangan", "financial astrology", "astrologi", "astrology", "astro trading", "pengaruh planet", "pengaruh astronomi", "astronomi terhadap harga", "planet terhadap harga", "gann", "bradley", "siderograph"],
    body: "Astrologi keuangan mencoba menghubungkan posisi planet dengan pergerakan pasar. Tokohnya antara lain W.D. Gann (1878–1955, siklus waktu dan sudut), Donald Bradley (Bradley Siderograph, 1948: skor gabungan aspek planet untuk menandai titik balik), hingga Arch Crawford dan Bill Meridian. Klaim umumnya: aspek tegang (square, oposisi) dan retrograde menandai gejolak; aspek harmonis menandai ketenangan.",
    deeper: "Belum ada mekanisme fisik yang diketahui: gravitasi planet terhadap Bumi sangat kecil, dan retrograde hanyalah ilusi sudut pandang. Secara statistik, masalah terbesarnya pengujian berganda: dengan ratusan jenis kejadian langit, sebagian pasti tampak signifikan secara kebetulan. Aplikasi ini menguji semua vonis astrologi secara walk-forward 2018–2026: emas benar 441 dari 861 (51%), BTC 384 dari 734 (52%), DXY 336 dari 672 (50%), setara lempar koin. Satu-satunya efek \"kalender\" yang punya dukungan akademik berasal dari musim dan, lebih lemah, fase bulan; lihat topik itu.",
    related: ["retrograde", "lunar-cycle", "seasons", "testing-astro", "aspects"],
  },
  {
    id: "retrograde",
    title: "Retrograde",
    keys: ["retrograde", "retro", "mundur", "gerak mundur", "apa itu retrograde", "stasioner", "station"],
    body: "Retrograde adalah saat sebuah planet tampak bergerak mundur di langit dilihat dari Bumi. Planet tidak benar-benar berbalik; efeknya mirip saat mobil Anda menyalip mobil lain yang lebih lambat, mobil itu tampak mundur. Merkurius retrograde 3–4 kali setahun sekitar 3 minggu; Venus tiap ±19 bulan selama ±40 hari; Mars tiap ±26 bulan selama ±2,5 bulan; Jupiter hingga Pluto sekitar 4–5 bulan setiap tahun.",
    deeper: "Dalam tradisi astrologi, Merkurius retrograde dikaitkan dengan gangguan komunikasi, teknologi, dan kontrak, lalu diperluas ke pasar (\"jangan masuk posisi baru\"). Titik stasioner (planet berhenti sebelum berbalik) dianggap paling kuat, dan ada masa shadow sebelum dan sesudahnya. Tanyakan \"bagaimana emas selama Merkurius retrograde\" untuk melihat statistik dari data aplikasi, atau buka tampilan ℞ Periode Retrograde untuk jadwal sampai hitungan menit.",
    related: ["shadow", "testing-astro", "financial-astrology"],
  },
  {
    id: "shadow",
    title: "Periode shadow",
    keys: ["shadow", "pre shadow", "post shadow", "pre-shadow", "post-shadow", "bayangan retrograde"],
    body: "Periode shadow adalah rentang derajat zodiak yang dilalui planet tiga kali karena retrograde. Pre-shadow dimulai saat planet pertama kali mencapai derajat tempat ia nanti kembali direct; post-shadow berakhir saat planet kembali ke derajat tempat ia mulai retrograde.",
    deeper: "Untuk Merkurius, shadow menambah sekitar 2 minggu sebelum dan sesudah retrograde, sehingga seluruh episode bisa mencapai ±2 bulan. Artinya hampir separuh tahun berada dalam retrograde atau shadow Merkurius, salah satu alasan sulit membedakan \"efek\" retrograde dari gerak pasar biasa. Tampilan ℞ Periode Retrograde menghitung tanggal shadow dari posisi planet yang presisi.",
    related: ["retrograde", "testing-astro"],
  },
  {
    id: "aspects",
    title: "Aspek planet",
    keys: ["aspek", "aspect", "konjungsi", "conjunction", "square", "oposisi", "opposition", "trine", "sextile", "orb", "great conjunction", "konjungsi besar"],
    body: "Aspek adalah sudut antara dua planet dilihat dari Bumi: konjungsi 0°, sextile 60°, square 90°, trine 120°, oposisi 180°. Dalam astrologi, square dan oposisi dianggap tegang, trine dan sextile harmonis, konjungsi memusatkan energi kedua planet. Orb adalah toleransi derajat yang masih dianggap aspek.",
    deeper: "Konjungsi Jupiter–Saturnus (great conjunction) terjadi kira-kira tiap 20 tahun (terakhir 21 Desember 2020) dan dalam astrologi dianggap penanda era. Kalender aplikasi ini mencatat aspek mayor yang tepat (orb 0°) antar planet; uji dampaknya tersedia di dialog tiap kejadian. Tanyakan misalnya \"konjungsi Jupiter Saturnus berikutnya\".",
    related: ["financial-astrology", "testing-astro"],
  },
  {
    id: "eclipses",
    title: "Gerhana",
    keys: ["gerhana", "eclipse", "saros", "gerhana matahari", "gerhana bulan", "solar eclipse", "lunar eclipse"],
    body: "Gerhana matahari terjadi saat Bulan tepat di antara Matahari dan Bumi (selalu saat bulan baru); gerhana bulan saat Bumi di antara Matahari dan Bulan (selalu saat purnama). Terjadi 4–7 kali setahun, berpasangan dalam musim gerhana kira-kira tiap 6 bulan. Siklus saros (±18 tahun 11 hari) mengulang gerhana yang mirip.",
    deeper: "Dalam astrologi, gerhana dianggap titik balik besar. Secara ilmiah gerhana dapat diprediksi ratusan tahun ke depan, sehingga kalau memang ada efek ke pasar, pasar seharusnya sudah memperhitungkannya. Aplikasi ini menghitung gerhana dengan metode Meeus; tanyakan \"gerhana berikutnya\" atau \"pengaruh gerhana terhadap emas\".",
    related: ["lunar-cycle", "testing-astro", "financial-astrology"],
  },
  {
    id: "lunar-cycle",
    title: "Fase bulan dan pasar",
    keys: ["fase bulan", "lunar", "lunar cycle", "siklus bulan", "purnama", "full moon", "bulan baru", "new moon", "moonstruck"],
    body: "Bulan mengelilingi Bumi sekitar 29,5 hari (bulan sinodik): bulan baru → kuartal pertama → purnama → kuartal akhir. Inilah satu-satunya kalender astronomi yang pernah diuji serius oleh akademisi keuangan.",
    deeper: "Dichev & Janes (2003) dan Yuan, Zheng & Zhu (2006, 48 negara) menemukan return saham di sekitar bulan baru sedikit lebih tinggi daripada di sekitar purnama, sekitar 3–5% per tahun, yang mereka kaitkan dengan suasana hati investor, bukan gravitasi. Efeknya kecil, tidak muncul di semua periode, dan sulit diperdagangkan setelah biaya. Untuk emas, BTC, dan DXY, uji di aplikasi ini tidak menemukan efek yang konsisten.",
    related: ["eclipses", "seasons", "testing-astro"],
  },
  {
    id: "seasons",
    title: "Musim, ingress Matahari, dan efek kalender",
    keys: ["musim", "season", "ekuinoks", "equinox", "solstis", "solstice", "sell in may", "halloween", "efek kalender", "calendar effect", "zodiak matahari", "ingress matahari"],
    body: "Ingress Matahari ke Aries, Cancer, Libra, dan Capricorn adalah ekuinoks dan solstis: awal musim di belahan utara. Efek kalender yang paling banyak diteliti: \"Sell in May and go away\" (saham cenderung lebih lemah Mei–Oktober daripada November–April), dan pola musiman komoditas (permintaan minyak musim panas, emas menjelang musim festival India dan Imlek).",
    deeper: "Bouman & Jacobsen (2002, American Economic Review) menemukan efek Halloween di 36 dari 37 negara; Kamstra, Kramer & Levi (2003) mengaitkan musim gugur–dingin dengan perubahan selera risiko (\"winter blues\"). Model quant aplikasi ini hanya memakai musim dari posisi Matahari sebagai fitur astronomi, karena fase bulan, gerhana, dan retrograde tidak menambah akurasi. Dalam data aplikasi, efek musim minyak di musim gugur bertahan 2005–2015 tapi tidak sejak 2016. Tanyakan \"pola musiman emas\" untuk rata-rata return per bulan.",
    related: ["lunar-cycle", "testing-astro", "seasonality"],
  },
  {
    id: "seasonality",
    title: "Musiman (seasonality) harga",
    keys: ["musiman", "seasonality", "pola bulanan", "bulan terbaik", "bulan terburuk", "pola tahunan"],
    body: "Seasonality melihat rata-rata return per bulan kalender (Januari, Februari, …) atau per hari dalam minggu, untuk melihat apakah ada pola berulang.",
    deeper: "Dengan 12 bulan, satu atau dua akan selalu tampak menonjol secara kebetulan. Pola yang layak dipercaya punya alasan ekonomi (pajak akhir tahun, musim permintaan), bertahan di sub-periode berbeda, dan tidak hanya disetir satu tahun ekstrem. Jawaban musiman di chat ini menampilkan juga persentase tahun yang naik di bulan itu, bukan hanya rata-ratanya.",
    related: ["seasons", "testing-astro"],
  },
  {
    id: "zodiac-systems",
    title: "Zodiak tropis dan sideris",
    keys: ["tropis", "tropical", "sideris", "sidereal", "presesi", "precession", "ayanamsa", "vedic", "weda", "rasi"],
    body: "Zodiak tropis (astrologi Barat, dipakai aplikasi ini) diikat pada ekuinoks: 0° Aries = titik ekuinoks Maret. Zodiak sideris (astrologi Weda/India) diikat pada bintang latar. Karena presesi sumbu Bumi, keduanya kini berselisih sekitar 24°: Matahari yang \"Scorpio\" tropis kebanyakan masih \"Libra\" sideris.",
    deeper: "Presesi berputar sekitar 1° tiap 72 tahun (satu putaran ±25.800 tahun). Perbedaan sistem ini sering tidak disebutkan dalam prediksi astrologi pasar, padahal mengubah tanggal semua ingress. Posisi yang ditampilkan aplikasi ini adalah tropis, geosentris, dan tampak (sudah dikoreksi waktu cahaya dan aberasi), sama seperti efemeris astrologi Barat pada umumnya.",
    related: ["financial-astrology", "seasons"],
  },
  {
    id: "testing-astro",
    title: "Cara menguji klaim astrologi (dan hasilnya di aplikasi ini)",
    keys: ["uji", "menguji", "terbukti", "bukti", "ilmiah", "valid", "backtest", "walk forward", "placebo", "kebetulan", "statistik", "signifikan", "akurasi", "seberapa akurat"],
    body: "Klaim \"planet X membuat harga Y bergerak\" bisa diuji: ambil semua kejadian X di masa lalu, ukur gerak harga sesudahnya, bandingkan dengan gerak harga pada hari-hari biasa di era dan kondisi pasar yang sama, lalu uji di data yang tidak dipakai untuk menyusun aturan (walk-forward).",
    deeper: "Hasil uji aplikasi ini: (1) vonis astrologi Astro Calendar, walk-forward 2018–2026: emas 51%, BTC 52%, DXY 50% benar (lempar koin); (2) model quant dengan fitur astronomi (retrograde, fase bulan, gerhana, aspek, ingress) tidak lebih baik daripada tanpa fitur itu, sehingga hanya musim yang dipertahankan; (3) prakiraan arah 5–20 hari belum mengalahkan tebakan sederhana di 30 dari 30 kombinasi pasar. Jebakan yang membuat astrologi tampak berhasil: memilih contoh yang cocok (bias konfirmasi), menguji ratusan pola tanpa koreksi, dan aturan yang cukup lentur untuk menjelaskan apa pun.",
    related: ["financial-astrology", "retrograde", "quant-model"],
  },

  // ---------------------------------------------------------------- macro
  {
    id: "gold-drivers",
    title: "Apa yang menggerakkan emas",
    keys: ["penggerak emas", "faktor emas", "kenapa emas naik", "kenapa emas turun", "emas dan dolar", "emas dan yield", "real yield", "yield riil", "safe haven", "bank sentral beli emas"],
    body: "Penggerak utama emas: (1) yield riil AS (yield obligasi dikurangi inflasi): emas tidak memberi bunga, jadi saat yield riil turun emas cenderung naik; (2) dolar AS: emas dihargai dalam dolar, biasanya bergerak berlawanan dengan DXY; (3) permintaan safe haven saat krisis; (4) pembelian bank sentral; (5) permintaan perhiasan dan investasi di India dan Tiongkok.",
    deeper: "Hubungan emas–yield riil sangat kuat 2006–2021, lalu melemah sejak 2022 ketika bank sentral (terutama di negara berkembang) membeli emas dalam jumlah rekor, sehingga emas naik meski yield riil tinggi. Hubungan dengan DXY juga tidak selalu negatif; tanyakan \"korelasi emas dan dxy\" untuk angka dari data aplikasi pada periode yang Anda pilih.",
    related: ["dxy", "macro-releases", "fomc"],
  },
  {
    id: "dxy",
    title: "Indeks dolar (DXY)",
    keys: ["dxy", "indeks dolar", "dollar index", "apa itu dxy", "dolar menguat", "dolar melemah"],
    body: "DXY mengukur dolar AS terhadap enam mata uang: euro (±58%), yen, pound, dolar Kanada, krona Swedia, dan franc Swiss. Karena euro mendominasi, DXY pada dasarnya cermin terbalik EUR/USD. Dolar biasanya menguat saat suku bunga AS relatif naik dan saat pasar mencari aman.",
    deeper: "Dolar disebut \"smile\": menguat saat ekonomi AS jauh lebih kuat dari dunia dan juga saat krisis global (permintaan dolar likuid), melemah di tengah-tengah saat ekonomi dunia tumbuh bersama. Data yang paling menggerakkan DXY dalam hitungan menit: CPI, NFP, dan keputusan FOMC; lihat tab Reaksi di Live TV.",
    related: ["gold-drivers", "fomc", "macro-releases"],
  },
  {
    id: "fomc",
    title: "FOMC dan The Fed",
    keys: ["fomc", "the fed", "fed", "federal reserve", "suku bunga", "rate cut", "rate hike", "pemangkasan suku bunga", "kenaikan suku bunga", "dot plot", "powell", "warsh", "hawkish", "dovish"],
    body: "FOMC adalah komite The Fed yang menetapkan suku bunga acuan AS, bertemu 8 kali setahun. Keputusan diumumkan pukul 14.00 waktu New York, lalu konferensi pers ketua pukul 14.30. Hawkish berarti condong ke suku bunga tinggi/ketat (biasanya dolar dan yield naik, emas dan saham tertekan); dovish sebaliknya.",
    deeper: "Pasar bergerak karena kejutan dibanding ekspektasi, bukan karena keputusannya sendiri: pemangkasan yang sudah diperkirakan 100% oleh CME FedWatch sering hampir tidak menggerakkan harga. Uji di aplikasi ini: indeks kata-kata konferensi pers searah dengan keputusan suku bunga (r 0,60), tetapi tidak menebak reaksi pasar selama konferensi pers (uji peringkat ρ 0,14 pada 57 konferensi 2019–2026). Lihat Live TV → THE FED untuk jadwal, FedWatch, dan transkrip live.",
    related: ["macro-releases", "dxy", "gold-drivers"],
  },
  {
    id: "macro-releases",
    title: "Rilis data ekonomi AS (CPI, NFP, ISM)",
    keys: ["cpi", "inflasi", "nfp", "non farm payroll", "payroll", "tenaga kerja", "pengangguran", "ism", "pmi", "data ekonomi", "rilis data", "consensus", "konsensus", "surprise", "kejutan data"],
    body: "Data AS yang paling menggerakkan pasar: CPI (inflasi, sekitar pertengahan bulan), NFP dan tingkat pengangguran (Jumat pertama tiap bulan), ISM manufaktur dan jasa (awal bulan), serta PCE (inflasi pilihan The Fed). Yang penting adalah selisih dengan konsensus: angka di atas perkiraan untuk inflasi dan tenaga kerja dibaca hawkish.",
    deeper: "Uji di aplikasi ini: arah kejutan menebak gerak 30 menit pertama sekitar 65–75% (emas 72%, yield 2 tahun 75%), tetapi gerak sepanjang hari hanya sekitar 50–60%; efeknya cepat habis. Minyak sering bergerak berlawanan (data panas = permintaan kuat). Hari-hari rilis ini juga melebarkan rentang harga wajar di model quant.",
    related: ["fomc", "volatility", "gold-drivers"],
  },
  {
    id: "btc-halving",
    title: "Halving bitcoin dan siklus 4 tahun",
    keys: ["halving", "siklus bitcoin", "siklus 4 tahun", "4 year cycle", "bitcoin cycle", "musim dingin kripto", "crypto winter", "bull run", "altseason"],
    body: "Halving memotong separuh imbalan penambang BTC kira-kira tiap 4 tahun (210.000 blok): November 2012, Juli 2016, Mei 2020, April 2024; berikutnya diperkirakan sekitar 2028. Sejauh ini, puncak harga besar datang 12–18 bulan setelah halving (akhir 2013, akhir 2017, akhir 2021), diikuti penurunan 75–85%.",
    deeper: "Dengan hanya 3–4 siklus, polanya terlalu sedikit untuk disebut terbukti; siklus likuiditas global dan suku bunga juga bertepatan dengan puncak-puncak itu. Sejak ETF bitcoin spot AS (Januari 2024), aliran dana institusi menjadi penggerak baru. Model quant aplikasi ini menemukan BTC lebih bergejolak di musim dingin (belahan utara) dan memperhitungkannya pada rentang harganya.",
    related: ["volatility", "drawdown", "seasons"],
  },
  {
    id: "risk-on-off",
    title: "Risk-on dan risk-off",
    keys: ["risk on", "risk off", "risk-on", "risk-off", "sentimen pasar", "fear", "greed", "panik", "safe haven"],
    body: "Risk-on: investor berani mengambil risiko (saham, kripto, mata uang komoditas naik). Risk-off: investor mencari aman (dolar AS, yen, franc Swiss, obligasi pemerintah, kadang emas naik; saham dan kripto turun). VIX yang tinggi biasanya menandai risk-off.",
    deeper: "Peran BTC tidak konsisten: sering bergerak bersama saham teknologi (risk-on), bukan sebagai \"emas digital\" saat krisis. Emas bisa turun pada hari-hari awal kepanikan karena dijual untuk menutup margin, lalu naik setelahnya (misalnya Maret 2020).",
    related: ["gold-drivers", "dxy", "btc-halving"],
  },

  // ---------------------------------------------------------------- the app
  {
    id: "quant-model",
    title: "Model quant (Prakiraan)",
    keys: ["model quant", "quant", "prakiraan", "xgboost", "gradient boosting", "machine learning", "ai", "model prediksi", "cara kerja prakiraan"],
    body: "Prakiraan di aplikasi ini memakai gradient-boosted trees (gaya XGBoost, kedalaman 3) per aset dan horizon 5, 10, 20 hari. Fiturnya: momentum, tren, volatilitas, aset lain (DXY, yield, VIX, saham, minyak, emas, BTC), kejutan data AS, dan musim dari posisi Matahari. Diuji walk-forward per tahun sejak 2016.",
    deeper: "Hasil jujurnya: arah naik/turun belum mengalahkan tebakan \"pasar biasanya naik\" di satu pun dari 30 kombinasi, sehingga semua vonis ditampilkan Netral; versi XGBoost lebih dekat ke kenyataan (Brier skill −0,54%) daripada regresi logistik sebelumnya (−1,64%), tapi tetap tanpa sinyal. Yang berguna: rentang harga wajar P10–P90, lebih baik daripada rentang biasa di 27 dari 30 pasar.",
    related: ["testing-astro", "volatility"],
  },
  {
    id: "app-astro",
    title: "Panduan Astro Calendar",
    keys: ["astro calendar", "kalender astro", "cara pakai kalender", "tampilan retrograde", "zodiak matahari tab", "dialog kejadian", "titik warna"],
    body: "Astro Calendar punya empat tampilan: Kalender (kejadian langit per bulan, titik warna = prakiraan quant GOLD/BTC/DXY), ℞ Periode Retrograde (jadwal retrograde tiap planet sampai menit, dengan shadow), ☉ Zodiak Matahari (tanggal masuk Matahari ke tiap zodiak), dan Tanya (chat ini). Klik sebuah kejadian di kalender untuk melihat uji dampak historisnya.",
    deeper: "Semua posisi planet dihitung offline dari posisi presisi (astronomy-engine untuk retrograde dan ingress, elemen JPL untuk kalender), dicocokkan dengan efemeris resmi: retrograde Merkurius 2026 selisih < 5 menit, ingress Matahari 2026 selisih < 1 menit. Harga emas, BTC, dan DXY tersimpan di aplikasi sejak 1990 (BTC sejak 2011) dan diperbarui saat aplikasi terhubung.",
    related: ["retrograde", "testing-astro", "quant-model"],
  },
];

const tokenSet = (s: string) => new Set(s.split(" "));

/**
 * The topic a question is about, by the keys it uses (a longer key, a phrase, counts more), and a
 * second-best one: null when nothing matches well enough.
 */
export function findTopic(text: string, exclude?: string): Topic | null {
  const words = tokenSet(text);
  let best: Topic | null = null;
  let bestScore = 0;
  for (const t of TOPICS) {
    if (t.id === exclude) continue;
    let score = 0;
    for (const k of t.keys) {
      const hit = k.includes(" ") ? text.includes(k) : words.has(k);
      if (hit) score += k.includes(" ") ? 2 + k.split(" ").length : k.length >= 4 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 2 ? best : null;
}

export const topicById = (id: string) => TOPICS.find((t) => t.id === id) ?? null;
