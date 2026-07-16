# hanekawa

Chatbot ringan berbasis **OpenRouter (fallback antar beberapa model gratis)**, frontend statis + backend Vercel Edge Function.

## Soal model gratis

- Pakai fitur resmi OpenRouter **model fallback array**: `api/chat.js` ngirim daftar beberapa model gratis sekaligus (`meta-llama/llama-3.3-70b-instruct:free` → `nvidia/nemotron-3-super-120b-a12b:free` → `openai/gpt-oss-120b:free` → `openrouter/free` sebagai jaring pengaman terakhir). Kalau model pertama down/dicabut/kena limit, OpenRouter **otomatis coba yang berikutnya** dalam request yang sama — gak perlu ganti kode manual tiap kali ada model gratis yang ilang (kayak yang kejadian ke DeepSeek dan Kimi K2.6 sebelumnya).
- Limit bawaan OpenRouter buat model gratis: **20 request/menit**, dan **50 request/hari** (naik permanen jadi **1000/hari** kalau akun kamu pernah topup minimal $10 total, walau saldo sekarang $0 lagi). Ini aturan platform, bukan sesuatu yang diatur dari kode.
- Kalau kena limit di SEMUA model dalam daftar (jarang banget), chatbot bakal kasih pesan "🚦 Limit model gratis abis dulu..." — tinggal tunggu 1-2 menit atau besok.
- Daftar model di `MODEL_FALLBACKS` (`api/chat.js`) bisa ditambah/dikurangin/diurutkan ulang kapan aja — cek daftar gratis terbaru di https://openrouter.ai/models (filter Price: Free).

## Struktur folder

```
hanekawa/
├── api/
│   └── chat.js           # Edge Function: proxy ke OpenRouter + error handling
├── static/
│   ├── script.js         # Logic chat, sidebar, PWA install
│   ├── style.css         # Styling (neubrutalism)
│   ├── sw.js             # Service worker (cache offline-first)
│   ├── site.webmanifest  # Manifest PWA
│   └── favicon*, apple-touch-icon.png
├── index.html             # Markup utama
├── vercel.json             # Config Edge Function + security headers
├── .env.example            # Contoh env var (copy jadi .env buat lokal)
├── .gitignore
└── README.md
```

## Cara jalanin ulang

1. Ambil API key gratis di https://openrouter.ai/keys (login → Create Key).
2. Copy `.env.example` jadi `.env` kalau mau tes lokal pakai `vercel dev` (isi `OPENROUTER_API_KEY` di situ).
3. Deploy repo ini ke Vercel (import project dari GitHub, atau `vercel` CLI).
4. Di Vercel: **Project Settings → Environment Variables** → tambahkan:
   - `OPENROUTER_API_KEY` = key kamu dari langkah 1
5. Redeploy. Selesai — buka domain Vercel-nya, chatbot langsung aktif.

> **Penting:** kalau semua model di `MODEL_FALLBACKS` ternyata kena masalah bersamaan (jarang), cek daftar gratis terbaru di https://openrouter.ai/models (filter Price: Free) dan update array-nya di `api/chat.js`. Mau ganti balik ke model berbayar (misal Claude Opus 4.8 atau DeepSeek V3.2) buat kualitas lebih tinggi juga tinggal ganti jadi `models: ["anthropic/claude-opus-4.8"]` di bagian fetch body.

## Setup dari nol (belum ada repo GitHub / project Vercel)

**1. Push folder ini ke GitHub**
```bash
cd hanekawa-main
git init
git add .
git commit -m "init: hanekawa"
c
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```
(Buat dulu repo kosong di github.com — New repository, jangan centang "Add README" biar gak konflik — lalu copy URL-nya buat perintah `git remote add origin`.)

**2. Import ke Vercel**
- vercel.com → **Add New → Project** → pilih repo GitHub yang barusan dibuat
- Framework preset: biarin **"Other"**
- Klik **Deploy** dulu (bakal error karena env belum ada, gak masalah)

**3. Set environment variable**
- Project → **Settings → Environment Variables**
- Tambah `OPENROUTER_API_KEY` = key dari openrouter.ai/keys
- Centang semua environment (Production, Preview, Development) → Save

**4. Redeploy**
- Tab **Deployments** → deployment terakhir → (⋯) → **Redeploy**

Selesai, buka `xxx.vercel.app` yang dikasih Vercel.

## Struktur

- `index.html` + `static/` — frontend statis (neubrutalism UI, PWA-ready)
- `api/chat.js` — Vercel Edge Function, proxy ke OpenRouter, nge-handle error (rate limit, key invalid, timeout, dll) dengan pesan yang jelas
- `static/sw.js` — service worker buat cache offline-first

## Update keamanan (terbaru)

- **CORS dikunci ke domain sendiri**: `api/chat.js` sekarang cuma ngizinin request dari origin yang sama dengan domain yang diakses (dicek dari header `Host`), bukan `*` lagi. Jadi domain lain gak bisa numpang manggil API ini pakai API key/credit OpenRouter kita.
- **Fix sanitasi input**: sebelumnya karakter `<` dan `>` di-strip dari prompt user, jadi pertanyaan soal kode (`<div>`, `List<T>`, dll) kepotong. Sekarang gak di-strip lagi karena render di frontend sudah aman (DOMPurify men-sanitize semua konten — user & AI — sebelum masuk DOM).
- Rate limiting server-side **belum** ditambahin (sengaja di-skip dulu) — masih perlu ditambah kalau nanti butuh proteksi lebih terhadap abuse/spam.

## Yang dibenerin di versi ini

- Badge model sekarang selalu sinkron sama model asli yang dipanggil backend
- Riwayat chat yang dikirim ke API tidak lagi bergantung urutan push di frontend — pesan user selalu ditambahkan eksplisit di backend
- Error dibedain per jenis: key salah, rate limit, server OpenRouter down, timeout — masing-masing dengan pesan & aksi yang relevan
- Tombol **Stop** saat AI lagi mikir, tombol **Coba lagi** kalau gagal, tombol **Salin** di tiap balasan
- Cache service worker dinaikkan versinya supaya update UI gak nyangkut di versi lama
- UI dirombak total ke gaya **neubrutalism**: border tebal, hard-shadow offset, palet flat berani — dirapikan buat mobile & desktop
