import type { View } from "../store/terminal";

// The Academy's lessons: one module per group of the menu, in the order a trade idea is built,
// each lesson short, ending with where to practise it in the app and a question or two. Written
// for this app's tools; general market knowledge, not advice.

export type Quiz = { q: string; options: string[]; answer: number; why: string };
export type Lesson = { id: string; title: string; minutes: number; body: string[]; practice?: { view: View; label: string }; quiz: Quiz[] };
export type Module = { id: string; title: string; summary: string; lessons: Lesson[] };

export const MODULES: Module[] = [
  {
    id: "macro",
    title: "1 · Macro Command Center",
    summary: "Membaca gambaran besar sebelum mencari ide trade.",
    lessons: [
      {
        id: "regime",
        title: "Regime makro: pertumbuhan × inflasi",
        minutes: 5,
        body: [
          "Banyak pergerakan besar pasar dijelaskan oleh dua arah: apakah pertumbuhan ekonomi sedang menguat atau melemah, dan apakah inflasi sedang naik atau turun. Yang penting adalah arah perubahannya (momentum), bukan levelnya.",
          "Empat kombinasinya disebut kuadran: Goldilocks (pertumbuhan ↑, inflasi ↓), Reflasi (keduanya ↑), Stagflasi (pertumbuhan ↓, inflasi ↑), dan Deflasi/perlambatan (keduanya ↓).",
          "Teori umumnya: saham dan aset berisiko menyukai Goldilocks; komoditas dan energi menyukai Reflasi; emas dan sektor defensif bertahan di Stagflasi; obligasi pemerintah dan dolar unggul di Deflasi.",
          "Tapi teori tidak selalu terbukti. Halaman Macro Regime menghitung rata-rata return bulan berikutnya tiap aset di tiap kuadran sejak 2002, dan hanya menyebut bias \"terukur\" bila perbedaannya nyata secara statistik. Seringkali tidak — itu informasi juga: regime adalah konteks, bukan sinyal beli/jual.",
          "Regime juga cepat berganti (rata-rata sekitar 2 bulan per periode dengan metode ini). Pakai untuk menimbang bias, bukan untuk memaksakan posisi.",
        ],
        practice: { view: "regime", label: "Buka Macro Regime" },
        quiz: [
          { q: "Pertumbuhan melemah tetapi inflasi naik. Kuadran apa?", options: ["Goldilocks", "Reflasi", "Stagflasi", "Deflasi"], answer: 2, why: "Stagflasi = pertumbuhan turun dengan inflasi naik — biasanya terberat bagi saham dan obligasi sekaligus." },
          { q: "Apa arti bias \"tidak nyata\" di tabel regime?", options: ["Aset pasti turun", "Rata-rata di regime itu tidak berbeda nyata dari bulan biasa aset tersebut", "Data salah", "Aset tidak boleh dibeli"], answer: 1, why: "Statistik t di bawah 2 berarti perbedaan bisa saja kebetulan." },
        ],
      },
      {
        id: "risk",
        title: "Risk-on, risk-off dan indikator stres",
        minutes: 4,
        body: [
          "Di atas regime ada suasana risiko jangka pendek. Tiga pengukur yang sering dipakai: VIX (perkiraan volatilitas S&P 500 30 hari ke depan), spread obligasi high-yield (tambahan imbal hasil yang diminta untuk meminjami perusahaan berisiko), dan kekuatan dolar.",
          "VIX jauh di atas median setahunnya, spread high-yield melebar cepat, dan dolar menguat tajam bersama-sama adalah gambaran risk-off: investor mencari aman, aset berisiko tertekan.",
          "Kurva yield terbalik (yield 2 tahun di atas 10 tahun) secara historis mendahului resesi, tetapi jedanya bisa lebih dari setahun — bukan alat timing.",
        ],
        practice: { view: "dashboard", label: "Lihat di Dashboard" },
        quiz: [{ q: "Mana kombinasi yang paling menggambarkan risk-off?", options: ["VIX turun, spread HY menyempit", "VIX melonjak, spread HY melebar, dolar menguat", "Saham naik, emas turun", "Yield naik karena pertumbuhan kuat"], answer: 1, why: "Volatilitas, biaya kredit dan permintaan dolar naik bersama saat pasar mencari aman." }],
      },
      {
        id: "market-scan",
        title: "Dari gambaran besar ke daftar pantauan",
        minutes: 3,
        body: [
          "Setelah tahu regime dan suasana risiko, persempit ke aset yang sejalan: cari yang bias regimenya mendukung DAN trennya searah (mis. harga di atas rata-rata 10 bulan atau 200 hari). Itulah logika shortlist di Macro Regime.",
          "Gunakan Market → Screener untuk mencari saham per sektor dan kinerja, Heatmap untuk melihat sektor mana yang menyala hari ini, dan Watchlist untuk memantau kandidat dengan perubahan harian, mingguan dan bulanan.",
        ],
        practice: { view: "market", label: "Buka Market" },
        quiz: [{ q: "Shortlist yang baik memerlukan…", options: ["Hanya berita bagus", "Bias regime dan tren harga yang sejalan", "Harga paling murah", "Volume paling kecil"], answer: 1, why: "Dua konfirmasi independen lebih kuat dari satu." }],
      },
    ],
  },
  {
    id: "policy",
    title: "2 · Policy & Expectations",
    summary: "Bank sentral, fiskal, dan apa yang sudah diperhitungkan pasar.",
    lessons: [
      {
        id: "fed",
        title: "Bank sentral dan ekspektasi suku bunga",
        minutes: 5,
        body: [
          "Harga aset bergerak karena kejutan terhadap ekspektasi, bukan karena berita itu sendiri. Kenaikan suku bunga yang sudah diperhitungkan penuh bisa membuat pasar naik.",
          "Futures Fed funds (ZQ) dan SOFR 3 bulan (SR3) dihargai 100 dikurangi suku bunga yang diharapkan. Membalik harganya memberi jalur suku bunga yang diperhitungkan pasar — itu yang ditampilkan halaman Futures untuk kurva suku bunga, dan FedWatch menerjemahkannya menjadi peluang tiap keputusan FOMC.",
          "Pidato dan konferensi pers Fed menggeser ekspektasi itu. Di Monetary Policy Anda bisa melihat kalender, FedWatch, suku bunga pendanaan (SOFR, RRP), dan di Live TV & Fed siaran serta transkripnya.",
        ],
        practice: { view: "futures", label: "Lihat kurva SOFR & Fed funds" },
        quiz: [
          { q: "Futures SOFR dihargai 95,75. Suku bunga tersiratnya?", options: ["95,75%", "4,25%", "0,9575%", "Tidak bisa dihitung"], answer: 1, why: "100 − 95,75 = 4,25%." },
          { q: "Pasar sering naik saat Fed menaikkan bunga karena…", options: ["Kenaikan bunga selalu bagus", "Kenaikan itu sudah diperhitungkan dan nada Fed tidak lebih keras dari dugaan", "Investor tidak membaca berita", "Kebetulan"], answer: 1, why: "Yang menggerakkan harga adalah selisih terhadap ekspektasi." },
        ],
      },
      {
        id: "fiscal",
        title: "Tekanan fiskal: defisit, bunga, dan TGA",
        minutes: 4,
        body: [
          "Pemerintah AS membiayai defisit dengan menerbitkan obligasi. Defisit yang besar dan terus-menerus berarti pasokan obligasi deras; bila permintaan tidak mengimbangi, yield (terutama tenor panjang) cenderung naik — yang disebut premi jangka (term premium).",
          "Ukuran tekanan fiskal yang praktis: bunga yang dibayar terhadap penerimaan pajak. Makin besar porsinya, makin sempit ruang anggaran.",
          "Treasury General Account (TGA) adalah rekening kas pemerintah di The Fed. Saat TGA diisi (misalnya setelah plafon utang dinaikkan), uang ditarik dari sistem perbankan — likuiditas mengetat. Saat TGA dibelanjakan, likuiditas bertambah.",
        ],
        practice: { view: "fiscal", label: "Buka Fiscal Policy" },
        quiz: [{ q: "TGA naik tajam dalam sebulan. Dampak umumnya ke likuiditas?", options: ["Menambah likuiditas", "Mengurangi likuiditas", "Tidak ada", "Hanya memengaruhi emas"], answer: 1, why: "Dana berpindah dari cadangan bank ke rekening pemerintah di Fed." }],
      },
      {
        id: "curves",
        title: "Kurva forward: contango dan backwardation",
        minutes: 4,
        body: [
          "Kurva futures menyusun harga kontrak dari bulan terdekat ke terjauh. Contango: kontrak jauh lebih mahal (biaya simpan, bunga; pasokan cukup). Backwardation: kontrak dekat lebih mahal (pasokan sekarang ketat atau ada permintaan mendesak).",
          "Bagi pemegang long futures, contango menggerus hasil saat kontrak di-roll (negative roll yield), backwardation menambahnya.",
          "Kurva VIX biasanya contango. Saat VIX berbalik ke backwardation, pasar membayar mahal untuk perlindungan sekarang — tanda stres yang kuat.",
        ],
        practice: { view: "futures", label: "Buka Futures" },
        quiz: [{ q: "Minyak backwardation tajam biasanya menandakan…", options: ["Pasokan longgar", "Pasokan dekat ketat", "Biaya simpan naik", "Dolar melemah"], answer: 1, why: "Pembeli bersedia membayar lebih untuk barang sekarang." }],
      },
    ],
  },
  {
    id: "flow",
    title: "3 · Flow & Participants",
    summary: "Siapa yang menggerakkan uang dan seberapa ramai posisinya.",
    lessons: [
      {
        id: "breadth",
        title: "Breadth: kualitas sebuah kenaikan",
        minutes: 4,
        body: [
          "Indeks bisa naik karena segelintir saham raksasa. Breadth mengukur berapa banyak saham yang ikut: persentase anggota di atas rata-rata 50 dan 200 hari, jumlah yang naik vs turun, yang dekat puncak 52 minggu.",
          "Kenaikan dengan breadth luas lebih sehat. Indeks naik sementara mayoritas saham di bawah rata-rata 200 hari adalah kenaikan sempit — lebih rapuh.",
          "S&P 500 bobot setara (RSP) yang tertinggal dari S&P biasa (SPY) adalah cara cepat melihat konsentrasi.",
        ],
        practice: { view: "etf", label: "Buka ETF & breadth" },
        quiz: [{ q: "S&P 500 rekor tertinggi, tetapi hanya 35% saham di atas MA 200. Artinya?", options: ["Kenaikan sangat sehat", "Kenaikan sempit, digerakkan sedikit saham", "Pasar pasti turun besok", "Data salah"], answer: 1, why: "Partisipasi rendah = konsentrasi tinggi." }],
      },
      {
        id: "rotation",
        title: "Rotasi sektor",
        minutes: 3,
        body: [
          "Uang berpindah antar sektor mengikuti siklus. Peta rotasi menempatkan tiap sektor menurut keunggulannya terhadap S&P 500 dalam 3 bulan (sumbu x) dan apakah bulan ini mempercepat atau memperlambat keunggulan itu (sumbu y).",
          "Urutan yang sering terjadi searah jarum jam: Membaik → Memimpin → Melemah → Tertinggal. Sektor di kuadran Membaik adalah kandidat pemimpin berikutnya, tetapi tidak selalu sampai.",
          "Volume relatif (RelVol) di atas 1,5 menandakan uang masuk/keluar lebih deras dari biasanya.",
        ],
        practice: { view: "etf", label: "Lihat peta rotasi" },
        quiz: [{ q: "Sektor tertinggal 3 bulan tetapi bulan ini menguat cepat berada di kuadran…", options: ["Memimpin", "Melemah", "Tertinggal", "Membaik"], answer: 3, why: "Relatif masih negatif, momentum positif." }],
      },
      {
        id: "cot",
        title: "Positioning: laporan COT dan crowding",
        minutes: 5,
        body: [
          "CFTC menerbitkan posisi pelaku futures setiap Jumat (posisi per Selasa). Untuk keuangan: asset manager, leveraged funds (hedge fund/CTA), dan dealer. Untuk komoditas: managed money (spekulan), produsen/pedagang (hedger), swap dealer.",
          "COT index menempatkan posisi bersih spekulan dalam rentang 3 tahunnya (0–100). Di atas 85: sisi long sudah ramai; di bawah 15: sisi short ramai.",
          "Posisi ramai bukan sinyal timing — tren bisa terus berjalan. Tetapi saat katalis berbalik, posisi ramai terurai bersama dan pergerakannya tajam. Gunakan sebagai pengukur risiko.",
        ],
        practice: { view: "participants", label: "Buka Market Participant" },
        quiz: [{ q: "COT index emas 95 dan tren masih naik. Sikap yang masuk akal?", options: ["Short sekarang juga", "Tetap ikut tren tapi sadar risiko pembalikan tajam; perketat manajemen risiko", "Abaikan saja", "Beli dua kali lipat"], answer: 1, why: "Crowding adalah peringatan risiko, bukan sinyal arah." }],
      },
    ],
  },
  {
    id: "intel",
    title: "4 · Intelligence & Risk",
    summary: "Memisahkan berita yang benar-benar mengubah risiko dari kebisingan.",
    lessons: [
      {
        id: "news",
        title: "Berita yang penting vs kebisingan",
        minutes: 4,
        body: [
          "Tanyakan tiga hal pada setiap berita: Apakah ini mengejutkan (di luar ekspektasi)? Apakah ini mengubah arus kas, suku bunga, atau pasokan? Apakah dampaknya terlihat di harga aset yang relevan?",
          "Berita kilat (mis. Watcher Guru) cepat tetapi belum tentu benar atau penting. Konfirmasi dari sumber utama dan lihat reaksi harga.",
          "Halaman Quantitative → Dampak berita mengukur seberapa besar pasar bergerak setelah jenis berita tertentu di masa lalu.",
        ],
        practice: { view: "intel", label: "Buka Market Intelligence" },
        quiz: [{ q: "Berita besar keluar tetapi emas, dolar dan yield tidak bergerak. Kesimpulan awal?", options: ["Berita sudah diperhitungkan atau dianggap tidak penting", "Pasar rusak", "Harus segera trade", "Sumber pasti salah"], answer: 0, why: "Reaksi harga adalah penilaian pasar atas pentingnya berita." }],
      },
      {
        id: "geo",
        title: "Risiko geopolitik dan aset pelarian",
        minutes: 4,
        body: [
          "Saat ketegangan geopolitik memanas, pola yang lazim: emas dan dolar menguat (pelarian), minyak naik bila pasokan terancam (Timur Tengah, Rusia), saham dan aset berisiko melemah, VIX naik.",
          "Kebanyakan guncangan geopolitik memudar dalam hitungan minggu kecuali mengubah pasokan energi atau perdagangan secara nyata. Bedakan nada eskalasi dari nada meredam (gencatan senjata, perundingan).",
          "Halaman Geopolitics mengukur seberapa ramai tiap tema dibanding biasanya, nadanya, dan pengukur aset pelarian hari ini.",
        ],
        practice: { view: "geo", label: "Buka Geopolitics" },
        quiz: [{ q: "Emas naik, VIX naik, S&P turun pada hari yang sama. Ini pola…", options: ["Risk-on", "Pencarian aman (safe haven)", "Reflasi", "Netral"], answer: 1, why: "Uang berpindah ke perlindungan." }],
      },
    ],
  },
  {
    id: "execution",
    title: "5 · Analysis & Execution",
    summary: "Dari tesis ke rencana yang bisa dievaluasi.",
    lessons: [
      {
        id: "plan",
        title: "Rencana trade: tesis, pemicu, invalidasi",
        minutes: 6,
        body: [
          "Rencana yang baik menjawab sebelum masuk: Apa tesisnya? Apa pemicunya (kapan masuk)? Di mana saya salah (stop/invalidasi)? Ke mana targetnya? Berapa besar posisinya?",
          "Reward-to-risk (R) = jarak ke target ÷ jarak ke stop. Dengan 2R, Anda impas bila benar sepertiga (±33%) dari trade, sebelum biaya — tetapi target harus realistis, bukan sekadar jauh.",
          "Ukuran posisi dari risiko: unit = (modal × % risiko) ÷ jarak entry–stop. Dengan risiko 1% per trade, sepuluh kekalahan beruntun hanya memotong ±10% modal.",
          "Nodes Plan memandu enam langkah ini dan membandingkan harga live dengan level Anda.",
        ],
        practice: { view: "nodes", label: "Buat rencana di Nodes Plan" },
        quiz: [
          { q: "Modal 10.000, risiko 1%, entry 100, stop 95. Berapa unit?", options: ["10", "20", "100", "200"], answer: 1, why: "(10.000 × 1%) ÷ 5 = 20 unit." },
          { q: "Entry 100, stop 95, target 110. Berapa R?", options: ["1R", "2R", "3R", "0,5R"], answer: 1, why: "(110 − 100) ÷ (100 − 95) = 2." },
        ],
      },
      {
        id: "quant",
        title: "Membaca model kuantitatif dengan jujur",
        minutes: 4,
        body: [
          "Model memberi peluang, bukan kepastian. Yang perlu dicek pertama: rekam jejaknya di luar sampel (walk-forward) dibanding tebakan dasar. Model yang tidak mengalahkan tebakan dasar sebaiknya tidak dipakai sebagai sinyal.",
          "Halaman Quantitative menampilkan akurasi walk-forward tiap model dan menandai yang terbukti atau tidak. Sebagian besar prakiraan arah harga jangka pendek tidak terbukti — itu normal di pasar yang efisien.",
          "Gunakan model sebagai salah satu input, dan perhatikan rentang (P10–P90): rentang lebar berarti ketidakpastian besar.",
        ],
        practice: { view: "quant", label: "Buka Quantitative" },
        quiz: [{ q: "Model akurasi 54% vs tebakan dasar 55%. Artinya?", options: ["Model bagus", "Model tidak menambah nilai dibanding tebakan dasar", "Pasti untung", "Perlu leverage lebih besar"], answer: 1, why: "Yang dihitung adalah kelebihan atas tebakan dasar." }],
      },
      {
        id: "regression",
        title: "Regresi multifaktor: membaca beta",
        minutes: 5,
        body: [
          "Regresi multifaktor mengukur seberapa besar sebuah pair ikut bergerak bersama beberapa penggerak besar sekaligus — S&P 500, dolar, yield 10 tahun, VIX, emas, minyak, bitcoin — dengan faktor lain dianggap tetap.",
          "Beta −1,4 untuk dolar pada emas berarti: di hari dolar naik 1%, emas rata-rata turun 1,4%. Statistik t (di atas ±2) dan nilai p (di bawah 0,05) menunjukkan apakah hubungan itu nyata atau bisa kebetulan. Standar error Newey-West dipakai agar volatilitas yang bergerombol tidak membuat hasil tampak lebih yakin dari seharusnya.",
          "R² memberi tahu berapa bagian gerak pair yang dijelaskan faktor-faktor itu; sisanya adalah gerak khas pair sendiri. VIF di atas 5 berarti dua faktor terlalu mirip sehingga beta masing-masing tidak bisa dipercaya terpisah. Bandingkan beta paruh awal dan akhir: beta yang berbalik tanda menandakan hubungan yang tidak stabil.",
          "Yang terpenting: ini sensitivitas pada hari yang sama, bukan ramalan. Uji ramal di aplikasi (faktor kemarin → pair hari ini, di luar sampel) hampir selalu tidak berdaya. Pakai beta untuk lindung nilai, ukuran posisi, dan memahami rilis mana yang akan menggerakkan pair Anda.",
        ],
        practice: { view: "quant", label: "Buka regresi di Quantitative" },
        quiz: [
          { q: "Beta pair terhadap S&P 500 = 1,0 dengan t = 5. Artinya?", options: ["Pair pasti naik besok", "Di hari S&P naik 1%, pair rata-rata naik ±1%, dan hubungannya nyata", "Pair dan S&P adalah aset yang sama", "Tidak ada hubungan"], answer: 1, why: "Beta = ukuran ikut-bergerak; t = 5 jauh di atas 2." },
          { q: "R² di luar sampel untuk ramalan hari berikutnya negatif. Kesimpulannya?", options: ["Model ramalan bagus", "Faktor kemarin tidak bisa meramal pair hari ini", "Datanya salah", "Perlu leverage"], answer: 1, why: "R² negatif = lebih buruk dari menebak rata-rata." },
        ],
      },
      {
        id: "chart",
        title: "Validasi teknikal dan timing",
        minutes: 3,
        body: [
          "Analisis teknikal paling berguna untuk timing dan menentukan level: tren (rata-rata 50/200 hari), support/resistance, dan konfirmasi volume.",
          "Gunakan timeframe lebih tinggi untuk arah, lebih rendah untuk entry. Hindari masuk tepat sebelum rilis besar kecuali itu memang rencananya.",
        ],
        practice: { view: "chart", label: "Buka Charting" },
        quiz: [{ q: "Arah sebaiknya ditentukan di timeframe…", options: ["Lebih rendah", "Lebih tinggi", "Tidak penting", "1 menit"], answer: 1, why: "Timeframe tinggi menyaring kebisingan." }],
      },
    ],
  },
  {
    id: "learning",
    title: "6 · Fundamental Research & Learning",
    summary: "Konteks fundamental dan lingkaran belajar.",
    lessons: [
      {
        id: "fundamentals",
        title: "Fundamental saham dalam 5 angka",
        minutes: 5,
        body: [
          "Pertumbuhan pendapatan (apakah bisnis membesar), margin (seberapa untung tiap penjualan), ROE (seberapa efisien modal dipakai), utang terhadap ekuitas/EBITDA (seberapa rapuh), dan valuasi (P/E, EV/EBITDA) dibanding peers dan sejarahnya sendiri.",
          "Saham bagus dengan valuasi terlalu mahal bisa menjadi investasi buruk. Bandingkan dengan peers di Financials → Peers, dan uji harga wajar dengan DCF.",
        ],
        practice: { view: "research", label: "Buka Financials" },
        quiz: [{ q: "P/E tinggi saja berarti saham…", options: ["Pasti mahal", "Perlu dibandingkan dengan pertumbuhan, peers dan sejarahnya", "Pasti naik", "Pasti turun"], answer: 1, why: "P/E tanpa konteks tidak cukup." }],
      },
      {
        id: "journal",
        title: "Jurnal dan lingkaran belajar",
        minutes: 3,
        body: [
          "Hasil satu trade dipengaruhi keberuntungan; proses yang konsisten tidak. Catat alasan sebelum masuk, ikuti rencana, lalu tinjau: apakah saya mengikuti pemicu, stop, dan ukuran?",
          "Tinjau per 20–30 trade, bukan per trade: hitung rata-rata R, win rate, dan kesalahan yang berulang. Ubah satu hal setiap kali.",
          "Notepad menyimpan catatan dan menautkannya ke rencana di Nodes Plan sehingga jejak keputusan Anda bisa ditelusuri.",
        ],
        practice: { view: "notepad", label: "Buka Notepad" },
        quiz: [{ q: "Trade untung tapi melanggar stop dan ukuran rencana. Dinilai…", options: ["Trade bagus", "Proses buruk walau hasil untung", "Tidak perlu dicatat", "Ulangi dengan ukuran lebih besar"], answer: 1, why: "Proses buruk yang kebetulan untung akan merugikan dalam jangka panjang." }],
      },
    ],
  },
];

export const allLessons = MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.id })));
