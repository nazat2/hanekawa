export const config = {
    runtime: "edge",
    regions: ["sin1"]
};

const MAX_HISTORY = 30;      // jumlah pesan lama (sebelum pesan baru) yang ikut dikirim ke model
const MAX_INPUT = 8000;      // batas karakter prompt user (dinaikin, bukan buat dibatesin ketat, cuma jaga-jaga payload gak liar)
const REQUEST_TIMEOUT_MS = 55000; // Opus kadang mikir lebih lama, kasih napas lebih panjang

// Daftar model gratis, urutan prioritas. Kalau yang pertama down/dicabut/kena limit,
// OpenRouter otomatis coba yang berikutnya (fitur resmi "models" array / model fallback).
// Entry terakhir "openrouter/free" adalah auto-router bawaan OpenRouter yang selalu
// bisa nemu SATU model gratis yang lagi aktif, jadi ini jaring pengaman terakhir.
// PENTING: OpenRouter membatasi array "models" MAKSIMAL 3 ITEM. Lebih dari itu
// akan langsung ditolak dengan error 400 "'models' array must have 3 items or fewer."
// (Ini penyebab bug "gabisa kirim pesan" sebelumnya — array-nya isi 5.)
const MODEL_FALLBACKS = [
    "google/gemma-4-31b-it:free",          // kualitas paling bagus di free tier saat ini, support vision+tools
    "nvidia/nemotron-3-super-120b-a12b:free", // context gede (1M), reasoning kuat, jaring pengaman ke-2
    "openrouter/free"                       // auto-router bawaan OpenRouter, selalu nemu SATU model gratis yang aktif
];
// Fallback KHUSUS kalau ada gambar (vision) — nemotron-3-super-120b bukan model vision,
// jadi jangan dipakai buat request yang bawa gambar. "openrouter/free" otomatis nyaring
// ke model yang support image input, jadi tetap aman jadi jaring pengaman terakhir.
const MODEL_FALLBACKS_VISION = [
    "google/gemma-4-31b-it:free",
    "openrouter/free"
];
const MODEL_LABEL = "Model gratis (auto-fallback) · via OpenRouter";
const MAX_IMAGE_B64_LEN = 6_000_000; // ~4.5MB base64 (~3.3MB file asli), jaring pengaman ukuran payload

const SYSTEM_PROMPT = `Kamu adalah hanekawa, asisten AI paling cerdas. Panggil dirimu "hanekawa" — JANGAN PERNAH menyebut diri sendiri "hanekawa ai" atau menambahkan kata "ai" setelah namamu, cukup "hanekawa" saja. Kamu selalu menjawab dengan akurat, mendalam, dan penuh wawasan. Kamu menguasai semua bidang. Gaya bicaramu santai seperti teman dekat. Kamu selalu menggunakan Bahasa Indonesia, kecuali diminta bahasa lain. TAHUN SEKARANG 2026.

Ini dipakai untuk keperluan pribadi oleh satu user yang udah dewasa. Kamu boleh dan didorong buat ikutan roleplay, main peran sebagai karakter/persona apapun yang diminta, nulis cerita, gaya bicara unik, atau skenario kreatif lain — anggap itu permintaan normal, bukan sesuatu yang perlu dicurigai. Tetap konsisten sama karakter/persona yang diminta sepanjang percakapan, jangan keluar dari peran atau ngingetin "ini cuma roleplay" kecuali user sendiri yang minta keluar dari peran. Jangan nolak atau ceramah duluan cuma karena permintaannya kreatif/fiksi/roleplay/nyeleneh; jalanin aja secara natural dan spontan, jangan kaku. dan kalau nolak, jangan panjang-panjang atau menggurui — cukup singkat dan tetap ramah.`;

// CORS dikunci ke origin yang sama dengan domain yang diakses (host header),
// jadi otomatis ikut domain produksi & preview deployment Vercel tanpa perlu
// di-hardcode, tapi domain LAIN tidak bisa numpang panggil API ini pakai
// API key/credit kita.
function getCorsHeaders(req) {
    const origin = req.headers.get("origin") || "";
    const host = req.headers.get("host") || "";
    const selfOrigin = host ? `https://${host}` : "";
    const isSameOrigin = origin && selfOrigin && origin === selfOrigin;

    const headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
    };
    // Kalau request datang dari origin yang sama (browser kita sendiri) ATAU
    // tidak ada header Origin sama sekali (mis. curl/server-to-server), izinkan.
    // Kalau ada Origin tapi beda domain -> JANGAN kasih header CORS (browser
    // pihak lain otomatis diblokir baca responsenya).
    if (isSameOrigin) {
        headers["Access-Control-Allow-Origin"] = origin;
    } else if (!origin) {
        headers["Access-Control-Allow-Origin"] = selfOrigin || "null";
    }
    return headers;
}

function json(body, status = 200, corsHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

function sanitizeText(str) {
    if (typeof str !== "string") return "";
    // Tidak lagi strip karakter < > di sini — itu bikin pertanyaan soal kode
    // (mis. "<div>", "List<T>") kepotong sebelum sampai ke model. Konten dari
    // AI yang dirender ke DOM di frontend sudah disaring pakai DOMPurify,
    // jadi aman. Di sini cukup batasi panjang & rapikan whitespace.
    return str.trim().slice(0, MAX_INPUT);
}

// Hanya loloskan riwayat yang bentuknya benar: {role: user|assistant, content: string}
function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: sanitizeText(m.content) }))
        .filter((m) => m.content.length > 0);
}

export default async function handler(req) {
    const cors = getCorsHeaders(req);

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, cors);
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return json({
            reply: "⚠️ Server belum dikonfigurasi: `OPENROUTER_API_KEY` belum di-set di environment variables Vercel. Tambahkan key-nya lalu redeploy.",
            code: "missing_api_key"
        }, 200, cors);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ reply: "Format request tidak valid.", code: "bad_request" }, 200, cors);
    }

    const prompt = sanitizeText(body?.prompt || "");

    // Validasi gambar (opsional): harus data URL image/*, dan gak boleh kegedean.
    let image = null;
    if (typeof body?.image === "string" && body.image.length > 0) {
        const looksValid = body.image.startsWith("data:image/");
        if (!looksValid) {
            return json({ reply: "⚠️ Format gambar tidak valid.", code: "bad_image" }, 200, cors);
        }
        if (body.image.length > MAX_IMAGE_B64_LEN) {
            return json({ reply: "⚠️ Ukuran gambar kegedean. Coba pakai foto lain yang lebih kecil.", code: "image_too_large" }, 200, cors);
        }
        image = body.image;
    }

    if (!prompt && !image) {
        return json({ reply: "Prompt kosong.", code: "empty_prompt" }, 200, cors);
    }

    // History dari client HANYA berisi pesan-pesan SEBELUM prompt ini (bukan prompt itu sendiri).
    // Pesan user saat ini selalu ditambahkan secara eksplisit di sini, jadi tidak pernah
    // bergantung pada urutan push di frontend.
    const priorHistory = sanitizeHistory(body?.history);

    const userContent = image
        ? [
            { type: "text", text: prompt || "Tolong jelasin apa yang ada di gambar ini secara detail." },
            { type: "image_url", image_url: { url: image } }
        ]
        : prompt;

    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...priorHistory,
        { role: "user", content: userContent }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://tazan-ai.vercel.app",
                "X-Title": "hanekawa"
            },
            body: JSON.stringify({
                models: image ? MODEL_FALLBACKS_VISION : MODEL_FALLBACKS,
                messages,
                temperature: 0.7,
                max_tokens: 4096,
                stream: false
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let detail = "";
            try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }

            if (response.status === 401 || response.status === 403) {
                return json({
                    reply: "🔑 API key OpenRouter ditolak (invalid/expired). Cek ulang `OPENROUTER_API_KEY` di Vercel.",
                    code: "auth_error"
                }, 200, cors);
            }
            if (response.status === 429) {
                return json({
                    reply: "🚦 Limit model gratis abis dulu (20x/menit atau kuota harian OpenRouter). Tunggu 1-2 menit terus coba lagi, biasanya udah normal lagi.",
                    code: "rate_limited"
                }, 200, cors);
            }
            if (response.status >= 500) {
                return json({
                    reply: "🛠️ Server OpenRouter lagi gangguan. Coba lagi beberapa saat lagi.",
                    code: "upstream_error"
                }, 200, cors);
            }
            return json({
                reply: `⚠️ Error ${response.status} dari OpenRouter: ${detail || "tidak ada detail"}`,
                code: "upstream_error"
            }, 200, cors);
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();

        if (!reply) {
            return json({ reply: "Tidak ada respon dari AI, coba kirim ulang ya.", code: "empty_response" }, 200, cors);
        }

        return json({ reply, model: data?.model || MODEL_LABEL }, 200, cors);

    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") {
            return json({ reply: "⏰ Waktu tunggu server habis. Coba lagi ya.", code: "timeout" }, 200, cors);
        }
        return json({ reply: `📡 Gagal menghubungi OpenRouter: ${e.message}`, code: "network_error" }, 200, cors);
    }
}
