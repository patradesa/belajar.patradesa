# Spesifikasi Blok Skenario Bercabang v1.0

Status: **diimplementasikan (Fase 1, branch feat/scenario-block)** · Tanggal: 23 November 2026 · Bagian dari paket LMS 2.0 (`../00-LMS-2.0-RENCANA-PENGEMBANGAN.md`).
Saat implementasi, salin folder ini ke repo `belajar.patradesa` sebagai `docs/scenario-block/`. Berkas acuan: lihat §12.

Dasar kode yang dirujuk (terverifikasi pada commit `e5de258`): konten pelajaran Markdown-lite → blok JSON (`packages/shared/src/content.ts`), render tanpa `innerHTML` (`apps/web/src/components/BlockRenderer.tsx`), rate limit D1 (`apps/api/src/lib/rateLimit.ts` → `enforceRateLimit`), format error `{"error":{"code","message"}}`, audit `admin_audit_logs`, exam lock ADR-0004.

---

## 1. Tujuan dan prinsip
Blok skenario melatih **pengambilan keputusan** di situasi nyata desa: peserta membaca situasi, memilih tindakan, langsung mendapat umpan balik beralasan, lalu situasi berlanjut sesuai pilihannya.

1. **Server memutuskan.** Kunci (verdict, skor, umpan balik, cabang berikutnya) hanya ada di server. Browser hanya menerima node yang sedang aktif.
2. **Satu node per layar.** Teks pendek, 2–4 opsi, cocok untuk HP 360 px dan sinyal lemah (±2–5 KB per langkah).
3. **Konten = data.** Tim konten menulis JSON (lihat `../02-PANDUAN-PENULIS-KONTEN.md`), validator memeriksa, penelaah menyetujui. Tidak perlu developer untuk modul baru.
4. **Jejak pilihan disimpan** untuk evaluasi materi dan laporan MEAL, tanpa menampilkan email peserta.
5. **Tidak ada HTML mentah.** Teks memakai Markdown terbatas dan dirender sebagai text node.

## 2. Konsep
| Istilah | Arti |
|---|---|
| Blok | Satu skenario utuh, dikenali oleh `id` (blockKey) + `version`. Versi yang sudah `published` tidak diubah; perubahan = versi baru. |
| Node `info` | Narasi/akibat; satu tombol **Lanjut**; wajib `nextNodeId`; tanpa opsi. |
| Node `decision` | Situasi + pertanyaan + 2–4 opsi. Tiap opsi punya `verdict`, `score` (0–10), `feedback`, `nextNodeId`. |
| Node `end` | Penutup cerita; memicu layar hasil. Tanpa opsi, tanpa `nextNodeId`. |
| Mode | `formative` = latihan, tidak memengaruhi kelulusan. `graded` = syarat sertifikat (lihat §7). |
| Band | Rentang persen → label + pesan di layar akhir. Wajib ada band `minPercent: 0`. |

Label verdict di UI: `best` → **Tepat**, `acceptable` → **Bisa diterima**, `risky` → **Berisiko**, `wrong` → **Kurang tepat**.

Alur adalah **graf berarah tanpa siklus** (DAG). Satu node dikunjungi paling banyak sekali per attempt, sehingga `(attempt, node)` unik.

**Skor.** `maxScore` = jumlah skor tertinggi di sepanjang jalur bernilai terbesar dari `startNodeId` ke node `end` (dihitung saat disimpan). Skor attempt = jumlah skor opsi yang dipilih. `percent = floor(score × 100 / maxScore)`. Band = band dengan `minPercent` terbesar yang ≤ `percent`. `passed = percent ≥ scoring.passPercent`.
Contoh `contoh-adm01-beda-nama-bali.json`: 3 keputusan × 10 = **maxScore 30**; jalur terbaik 30/30 = 100% (band "Sangat baik"); jalur terburuk 0/30 = 0% (band "Perlu mengulang").

## 3. Siklus hidup konten
`draft` → `in_review` → `published` → `archived`

- Simpan (`draft`/`in_review`): wajib lolos validasi struktur + alur (§6).
- `published`: wajib `review.reviewedBy`, `review.reviewedAt`, `review.nextReviewDue` (> reviewedAt). Hanya `admin` yang bisa menerbitkan/mengarsipkan (`content_editor` bisa menyimpan dan mengirim ke `in_review`). Bila penerbit = pembuat, audit mencatat `selfReviewed: true` (tidak diblokir; tim pilot kecil). Saat versi baru terbit, versi published lama otomatis `archived` (tetap terbaca oleh kelas yang sudah memasangnya). Semua transisi tercatat di `admin_audit_logs`.
- Paling banyak satu versi `draft`/`in_review` per blok. Menyimpan JSON untuk blok yang hanya punya versi `published` membuat versi baru.
- Blok `published` yang melewati `nextReviewDue` tetap tampil, tetapi muncul di daftar "perlu ditelaah" admin.
- `archived`: tidak bisa disisipkan ke versi kelas baru; attempt lama tetap terbaca.

## 4. Kontrak API peserta
Semua endpoint: wajib login (sesi + CSRF seperti route lain, ADR-0003), peserta terdaftar (enrollment aktif) di kelas yang memuat pelajaran berisi blok tersebut. Rate limit memakai `enforceRateLimit` (usulan: start 10/menit, choices 60/menit per user).

### 4.1 `POST /api/v1/scenarios/{blockId}/attempts`
Body: `{ "lessonId": "..." }`. Respons: delivery (§4.4). Membuat attempt baru **atau mengembalikan attempt `in_progress` yang sudah ada** (idempoten; unique index parsial §5).
Server: cek enrollment + blok dipasang di versi kelas peserta (`lesson_scenarios`), cek `attempt_no ≤ maxAttempts`, acak urutan opsi tiap node dengan `crypto.getRandomValues`, simpan sebagai `option_order_json`, snapshot profil (jabatan/desa) untuk statistik.
Respons `201`/`200`: bentuk delivery (§4.4).

### 4.2 `POST /api/v1/scenario-attempts/{attemptId}/choices`
Body keputusan: `{ "nodeId": "d1", "optionKey": "p3" }` · Body info: `{ "nodeId": "intro", "continue": true }`.
- `nodeId` ≠ `current_node_id` → `409 NODE_NOT_ACTIVE`.
- Kirim ulang pilihan yang **sama** untuk node yang sudah dijawab → kembalikan hasil yang sama (aman untuk koneksi putus). Pilihan **berbeda** → `409 ALREADY_ANSWERED`.
- Pembaruan bersyarat: `UPDATE scenario_attempts SET current_node_id=?, score=score+? WHERE id=? AND status='in_progress' AND current_node_id=?` + insert `scenario_choices` dalam satu `batch`.
- Respons: `{ "result": { "label": "Tepat", "verdict": "best", "feedback": "..." } | null, "delivery": <§4.4> }` (`result` null untuk node info).
Saat node berikutnya `end`: attempt difinalisasi (status `completed`, `percent`, `band_key`, `passed`) dan `delivery.final` berisi:
```json
{ "score": 26, "maxScore": 30, "percent": 86, "passed": true,
  "band": { "label": "Sangat baik", "message": "..." },
  "takeaways": ["..."], "remedial": { "label": "...", "lessonId": "..." },
  "attemptsLeft": 2 }
```

### 4.3 `GET /api/v1/scenario-attempts/{attemptId}`
Melanjutkan attempt (setelah refresh, ganti perangkat, atau koneksi putus). Bukan pemilik → **404** (bukan 403, agar keberadaan attempt tidak bocor).

### 4.4 Bentuk delivery
```json
{
  "attempt": { "id": "sa_...", "status": "in_progress", "attemptNo": 1, "maxAttempts": 3 },
  "block": { "key": "adm01-beda-nama-bali", "version": 1, "title": "...", "mode": "graded",
             "validFrom": "2026-11-01", "needsLocalValidation": true,
             "regulations": [{ "ref": "...", "note": "..." }], "estimatedMinutes": 8,
             "decisionCount": { "done": 1, "maxOnPath": 3 } },
  "node": { "id": "d2", "type": "decision", "title": "...", "body": "...", "prompt": "...",
            "options": [{ "key": "p1", "text": "..." }, { "key": "p2", "text": "..." }] },
  "history": [{ "nodeId": "d1", "optionText": "...", "label": "Tepat", "feedback": "..." }]
}
```
**Tidak pernah dikirim sebelum peserta memilih:** `verdict`, `score`, `feedback`, `nextNodeId` opsi mana pun, dan node selain node aktif.
**Tidak pernah dikirim sama sekali:** objek `scoring` (passPercent, bands mentah), `review` (termasuk `notes`), `authors`, id opsi asli (diganti `optionKey` p1–p4 hasil acak per attempt, agar urutan penulisan tidak membocorkan jawaban).
`history` hanya berisi pilihan yang sudah dibuat peserta sendiri.

### 4.5 Kode galat
| HTTP | code | Kapan |
|---|---|---|
| 401 | `UNAUTHENTICATED` | belum login |
| 404 | `NOT_FOUND` | blok/attempt tidak ada, bukan pemilik, atau tidak terdaftar |
| 409 | `NODE_NOT_ACTIVE` | `nodeId` bukan node aktif |
| 409 | `ALREADY_ANSWERED` | node sudah dijawab dengan opsi lain |
| 409 | `ATTEMPT_CLOSED` | attempt sudah `completed`/`abandoned` |
| 409 | `MAX_ATTEMPTS` | melebihi `maxAttempts` (kode yang sama dengan kuis) |
| 400 | `VALIDATION` | body tidak valid / `optionKey` tidak dikenal |
| 429 | `RATE_LIMITED` | batas laju |
Pesan untuk pengguna dalam Bahasa Indonesia lugas, mis. "Langkah ini sudah dijawab. Muat ulang untuk melanjutkan."

## 5. Saran tabel (migrasi D1 `0005_scenario_blocks.sql`)
```sql
CREATE TABLE scenario_blocks (
  id TEXT PRIMARY KEY,
  block_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','in_review','published','archived')),
  mode TEXT NOT NULL CHECK (mode IN ('formative','graded')),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  pass_percent INTEGER NOT NULL CHECK (pass_percent BETWEEN 0 AND 100),
  max_score INTEGER NOT NULL CHECK (max_score >= 0),      -- dihitung server saat simpan
  definition_json TEXT NOT NULL,                           -- JSON authoring utuh (tervalidasi)
  valid_from TEXT NOT NULL,
  reviewed_by TEXT, reviewed_at TEXT, next_review_due TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (block_key, version)
);

-- Dipin saat versi kelas diterbitkan (enrollment sudah dipin ke course_version, ADR-0002)
CREATE TABLE lesson_scenarios (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  scenario_block_id TEXT NOT NULL REFERENCES scenario_blocks(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, scenario_block_id)
);

CREATE TABLE scenario_attempts (
  id TEXT PRIMARY KEY,
  scenario_block_id TEXT NOT NULL REFERENCES scenario_blocks(id),
  block_version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')),
  current_node_id TEXT,
  option_order_json TEXT NOT NULL,                         -- {"d1":["c","a","d","b"], ...} → p1..p4
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL,
  percent INTEGER, band_key TEXT, passed INTEGER CHECK (passed IS NULL OR passed IN (0,1)),
  role_snapshot TEXT, village_snapshot TEXT, district_snapshot TEXT, regency_snapshot TEXT,
  started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
  UNIQUE (user_id, scenario_block_id, attempt_no)
);
CREATE UNIQUE INDEX ux_scenario_attempt_active
  ON scenario_attempts(user_id, scenario_block_id) WHERE status = 'in_progress';

CREATE TABLE scenario_choices (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES scenario_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  option_id TEXT,                                          -- NULL untuk node info
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('best','acceptable','risky','wrong')),
  score INTEGER NOT NULL DEFAULT 0,
  chosen_at INTEGER NOT NULL,
  UNIQUE (attempt_id, node_id),
  UNIQUE (attempt_id, seq)
);
CREATE INDEX ix_scenario_choices_stats ON scenario_choices(node_id, option_id);
```
Catatan: `block_version` disalin ke attempt agar statistik tidak tercampur antarversi. `max_score` disalin agar skor lama tidak berubah bila definisi diganti (seharusnya tidak terjadi; versi published tidak diubah).

## 6. Validasi (wajib identik dengan `validate_scenario.py`)
Saat admin/editor menyimpan, backend menjalankan:
1. **Struktur** sesuai `scenario-block.schema.json` (Zod di `packages/shared` boleh menggantikan validator JSON Schema asalkan aturan setara; jangan menambah dependensi berat).
2. **Aturan alur** F1–F9 (lihat docstring `validate_scenario.py`): id unik; rujukan valid; tanpa siklus; tanpa node yatim; ada `end` terjangkau; aturan opsi `best`; band `minPercent 0`; syarat `published`; `graded` ⇒ maxScore > 0.
3. **maxScore** dengan algoritma jalur terbesar (memoisasi DFS).

Galat dikembalikan sebagai `400 VALIDATION` dengan `details: [{ path, message }]`, mis. `{ path: '/nodes/3/options/1/nextNodeId', message: "node 'hilang' tidak ada" }`. Implementasi: `packages/shared/src/scenario.ts` (`validateScenario`), diuji di `tests/unit/scenario.test.ts`.
Kasus uji wajib (test backend): file contoh → valid, maxScore 30; enam kasus rusak → ditolak: siklus, rujukan node tidak ada, tanpa opsi `best`, node `info` punya opsi, `published` tanpa data penelaah, node yatim.

## 7. Integrasi ke pelajaran
- **Sintaks penyisipan** di `content_source` (Markdown-lite): satu baris tersendiri `[[skenario:adm01-beda-nama-bali]]`. Parser `content.ts` menghasilkan blok baru `{ "type": "scenario", "key": "adm01-beda-nama-bali" }`. Renderer lama yang tidak mengenal tipe ini tetap aman (tidak merender apa pun).
- **Simpan pelajaran (draft):** server memeriksa `key` merujuk blok yang ada dan tidak `archived`.
- **Terbitkan versi kelas:** setiap `key` wajib punya versi `published`; server mem-pin versi published terbaru ke `lesson_scenarios`. Peserta yang sudah terdaftar tetap memakai versi yang dipin di versi kelasnya.
- **Kelulusan:** `completionState` (`apps/api/src/services/certificates.ts`) ditambah syarat: setiap blok `graded` pada pelajaran wajib punya attempt `completed` dengan `passed = 1` (attempt terbaik). Blok `formative` hanya memengaruhi progres tampilan (dan XP di Fase 2).
- **Attempt habis tanpa lulus:** mengikuti pola kuis: admin/mentor dapat memberi tambahan 1 attempt (tercatat di audit log).
- **Exam lock (ADR-0004):** blok skenario **tidak** membuat lock ujian (bukan baris `attempts`). Lihat keputusan terbuka K1.

## 8. Frontend peserta
- Komponen `ScenarioBlock` dimuat **lazy** (`React.lazy`) saat blok mendekati viewport (IntersectionObserver), seperti `YoutubeEmbed`/`PdfViewer`. Target: bundle utama naik ≤ 5 KB gzip; chunk skenario ≤ 15 KB gzip.
- Tampilan sebelum mulai: kartu ringkas (judul, perkiraan menit, mode, "Berlaku per {validFrom}", banner **"Cek SOP desa/Disdukcapil setempat"** bila `needsLocalValidation`), tombol **Mulai**.
- Satu node per layar; opsi sebagai tombol besar (≥44 px) berisi teks lengkap; setelah memilih: label verdict berwarna + ikon (tidak bergantung warna saja) + umpan balik, diumumkan via `aria-live="polite"`, lalu tombol **Lanjut**.
- Fokus berpindah ke judul node baru; dapat dioperasikan penuh dengan keyboard; menghormati kontrol A−/A+ yang ada; uji lebar 360 px.
- Layar akhir: persen skor + label band + pesan, poin bawa pulang, tautan remedial, sisa kesempatan, tombol **Coba lagi** (bila boleh).
- Koneksi putus: pilihan dikirim ulang otomatis (idempoten, §4.2); saat kembali, `GET /attempts/{id}` melanjutkan dari node aktif. ID attempt aktif disimpan di `sessionStorage` (bukan data sensitif).
- Markdown terbatas: `**tebal**`, `*miring*`, daftar `- ` dan `1. `, paragraf. Tanpa HTML, tanpa gambar di v1.0.

## 9. Statistik admin
`GET /api/v1/admin/scenarios/{blockId}/stats?role=&regency=&district=&village=&from=&to=`
- Hanya `admin` dan `mentor` (mentor: hanya kelas yang ditugaskan, pola `mentor_assignments`). Setiap akses dicatat di `admin_audit_logs`.
- Isi: jumlah attempt, selesai, rata-rata persen, sebaran band, dan **sebaran pilihan per node** (jumlah & persen per opsi, dengan teks opsi dan verdict), per `block_version`.
- **Privasi:** tanpa nama/email peserta. Sel dengan < 5 peserta ditampilkan "< 5" (mencegah identifikasi peserta di desa kecil). Filter desa memakai snapshot teks profil; normalisasi nama desa adalah keputusan terbuka K3.
- Ekspor CSV agregat (bukan per orang) untuk laporan MEAL.

## 10. Alur editor (admin)
1. Penulis menyusun JSON (template di panduan penulis) → jalankan `validate_scenario.py` secara lokal.
2. Admin → **Skenario** → unggah/tempel JSON → server memvalidasi → simpan sebagai `draft` (versi baru bila `published` sudah ada).
3. **Pratinjau** pohon skenario (semua node, opsi, verdict, umpan balik) di halaman admin, tanpa membuat attempt; uji alur peserta memakai akun uji yang terdaftar di kelas draf/terbit.
4. Kirim ke `in_review` → penelaah mengisi review → `published`.
5. Sisipkan `[[skenario:key]]` di pelajaran → terbitkan versi kelas.
Editor visual (form per node) **bukan** bagian v1.0.

## 11. Keputusan terbuka
| ID | Pertanyaan | Usulan |
|---|---|---|
| K1 | Apakah attempt skenario `graded` ikut exam lock? | Tidak. Skenario adalah latihan bertahap dengan umpan balik langsung, bukan ujian; AI tutor juga masih nonaktif. Tinjau ulang bila AI diaktifkan. |
| K2 | Boleh mengulang setelah lulus? | Boleh selama sisa attempt ada; kelulusan memakai attempt terbaik. |
| K3 | Normalisasi nama desa untuk filter statistik & papan desa | Tambah tabel referensi wilayah (kode Kemendagri) di Fase 4; v1.0 memakai teks profil apa adanya. |
| K4 | Retensi `scenario_choices` | Ikuti kebijakan retensi attempt kuis yang akan diputuskan (usulan 24 bulan, lalu agregat). |
| K5 | Penelaah konten | Ditunjuk Gus per bidang (adminduk, perencanaan, keuangan). |

## 12. Berkas di folder ini
| Berkas | Fungsi |
|---|---|
| `README.md` | Spesifikasi ini (acuan utama) |
| `scenario-block.schema.json` | JSON Schema 2020-12 format authoring |
| `contoh-adm01-beda-nama-bali.json` | Contoh valid: 6 node, 3 keputusan, maxScore 30, status `draft`, data fiktif |
| `validate_scenario.py` | Validator acuan (Python stdlib): `python validate_scenario.py FILE.json [--json]` |

## 13. Catatan implementasi v1.0
- `remedial.lessonKey` dicocokkan dengan `lessons.lesson_key` di versi kelas yang sama; bila tidak cocok, layar akhir hanya menampilkan label remedial tanpa tautan.
- Skenario `graded` pada materi wajib dihitung sebagai "kuis" di progres `Kelas Saya` dan muncul sebagai alasan di `completion.reasons` halaman kelas.
- Delivery juga memuat `history` (pilihan peserta sendiri beserta label & umpan balik) dan `final` saat attempt selesai.
