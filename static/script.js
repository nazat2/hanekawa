(function () {
    "use strict";

    const WELCOME_HTML = `
        <div class="welcome-message" id="welcomeMessage">
            <div class="welcome-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <h2>Halo! Saya hanekawa 👋</h2>
        </div>`;

    function renderMarkdown(text) {
        if (!text) return "";
        let html;
        try {
            if (typeof marked !== "undefined") {
                marked.setOptions({ breaks: true, gfm: true });
                html = marked.parse(text);
            } else {
                html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            }
        } catch {
            html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        // Konten dari AI diperlakukan sebagai untrusted -> selalu disaring sebelum masuk DOM.
        if (typeof DOMPurify !== "undefined") {
            return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
        }
        return html;
    }

    const chatMessages = document.getElementById("chatMessages");
    const userInput = document.getElementById("userInput");
    const btnSend = document.getElementById("btnSend");
    const btnStop = document.getElementById("btnStop");
    const btnClear = document.getElementById("btnClear");
    const btnClearTop = document.getElementById("btnClearTop");
    const currentTime = document.getElementById("currentTime");
    const hamburgerBtn = document.getElementById("hamburgerToggle");
    const sidebar = document.getElementById("sidebar");
    const sidebarOverlay = document.getElementById("sidebarOverlay");
    const sidebarClose = document.getElementById("sidebarClose");
    const memoryCount = document.getElementById("memoryCount");
    const memoryInfo = document.getElementById("memoryInfo");
    const installBanner = document.getElementById("installBanner");
    const btnInstall = document.getElementById("btnInstall");
    const btnDismiss = document.getElementById("btnDismiss");
    const chatHistoryList = document.getElementById("chatHistoryList");
    const btnAttach = document.getElementById("btnAttach");
    const imageFileInput = document.getElementById("imageFileInput");
    const imagePreview = document.getElementById("imagePreview");
    const imagePreviewThumb = document.getElementById("imagePreviewThumb");
    const btnRemoveImage = document.getElementById("btnRemoveImage");
    const btnImageGen = document.getElementById("btnImageGen");

    let isProcessing = false;
    let chatHistory = [];       // { role: "user"|"assistant", content: string } -- pesan percakapan yang sedang aktif
    let conversations = [];     // { id, title, messages, updatedAt } -- daftar semua percakapan tersimpan
    let activeConversationId = null;
    let deferredPrompt = null;
    let activeController = null;
    let lastFailedPrompt = null;
    let pendingImage = null;    // dataURL gambar yang mau dilampirkan (vision), null kalau tidak ada
    let imageGenMode = false;   // true = mode "buat gambar", teks yang diketik jadi prompt generate gambar
    const IMG_MARKER = "@@GENIMG@@"; // prefix penanda konten pesan berupa gambar hasil generate

    const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    function updateTime() {
        if (!currentTime) return;
        const d = new Date();
        currentTime.textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    updateTime();
    setInterval(updateTime, 30000);

    /* ========== SIDEBAR ========== */
    function isDesktop() { return window.innerWidth >= 769; }

    function openSidebar() {
        document.body.classList.add("sidebar-open");
        if (isDesktop()) document.body.classList.remove("sidebar-closed");
        if (hamburgerBtn) hamburgerBtn.classList.add("active");
    }

    function closeSidebar() {
        document.body.classList.remove("sidebar-open");
        if (isDesktop()) document.body.classList.add("sidebar-closed");
        if (hamburgerBtn) hamburgerBtn.classList.remove("active");
    }

    function toggleSidebar() {
        if (document.body.classList.contains("sidebar-open")) closeSidebar();
        else openSidebar();
    }

    function initSidebar() {
        document.body.classList.remove("sidebar-open", "sidebar-closed");
        if (isDesktop()) {
            document.body.classList.add("sidebar-open");
            if (hamburgerBtn) hamburgerBtn.classList.add("active");
        } else if (hamburgerBtn) {
            hamburgerBtn.classList.remove("active");
        }
    }
    initSidebar();

    if (hamburgerBtn) hamburgerBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });
    if (sidebarClose) sidebarClose.addEventListener("click", () => closeSidebar());
    if (sidebarOverlay) sidebarOverlay.addEventListener("click", () => closeSidebar());

    document.addEventListener("click", (e) => {
        if (!document.body.classList.contains("sidebar-open")) return;
        if (isDesktop()) return;
        if (sidebar && sidebar.contains(e.target)) return;
        if (hamburgerBtn && hamburgerBtn.contains(e.target)) return;
        closeSidebar();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.body.classList.contains("sidebar-open") && !isDesktop()) closeSidebar();
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(initSidebar, 150);
    });

    let touchStartX = 0;
    document.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    document.addEventListener("touchend", (e) => {
        if (isDesktop()) return;
        const touchEndX = e.changedTouches[0].screenX;
        const deltaX = touchEndX - touchStartX;
        if (touchStartX < 35 && deltaX > 70 && !document.body.classList.contains("sidebar-open")) openSidebar();
        if (document.body.classList.contains("sidebar-open") && deltaX < -60) closeSidebar();
    }, { passive: true });

    /* ========== TINGGI LAYAR DINAMIS (anti ketutup keyboard) ========== */
    function setAppHeight() {
        const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty("--app-height", `${h}px`);
        scrollBottom();
    }
    setAppHeight();
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", setAppHeight);
        window.visualViewport.addEventListener("scroll", setAppHeight);
    } else {
        window.addEventListener("resize", setAppHeight);
    }
    userInput.addEventListener("focus", () => setTimeout(setAppHeight, 150));

    /* ========== GAMBAR: lampir (vision) & generate (Pollinations) ========== */
    // Kompres & resize foto sebelum dikirim, biar payload gak berat/gagal di HP
    // (foto kamera HP bisa 5-10MB, dikecilin ke maks 1280px + JPEG q0.75).
    function resizeImageFile(file, maxDim = 1280, quality = 0.75) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Gagal membaca file"));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error("File bukan gambar yang valid"));
                img.onload = () => {
                    let { width, height } = img;
                    if (width > maxDim || height > maxDim) {
                        if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
                        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
                    }
                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL("image/jpeg", quality));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function clearPendingImage() {
        pendingImage = null;
        if (imagePreview) imagePreview.hidden = true;
        if (imagePreviewThumb) imagePreviewThumb.src = "";
    }

    function setImageGenMode(on) {
        imageGenMode = on;
        if (btnImageGen) btnImageGen.classList.toggle("active", imageGenMode);
        if (userInput) userInput.placeholder = imageGenMode ? "Deskripsikan gambar yang mau dibuat..." : "Ketik pesan kamu...";
    }

    if (btnAttach) btnAttach.addEventListener("click", () => imageFileInput.click());

    if (imageFileInput) imageFileInput.addEventListener("change", async () => {
        const file = imageFileInput.files && imageFileInput.files[0];
        imageFileInput.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            createBubble("error", "⚠️ File itu bukan gambar.");
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            createBubble("error", "⚠️ Ukuran file kegedean (maks 20MB).");
            return;
        }
        if (imageGenMode) setImageGenMode(false); // gak bisa mode generate sambil lampir gambar
        try {
            pendingImage = await resizeImageFile(file);
            imagePreviewThumb.src = pendingImage;
            imagePreview.hidden = false;
        } catch {
            createBubble("error", "⚠️ Gagal memproses gambar, coba file lain.");
        }
    });

    if (btnRemoveImage) btnRemoveImage.addEventListener("click", clearPendingImage);

    if (btnImageGen) btnImageGen.addEventListener("click", () => {
        if (!imageGenMode && pendingImage) clearPendingImage(); // gak bisa dua mode sekaligus
        setImageGenMode(!imageGenMode);
    });

    function buildPollinationsUrl(prompt) {
        const seed = Math.floor(Math.random() * 1e9);
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
    }

    // opts.skipUserTurn: dipakai saat retry, bubble+riwayat user sudah ada, jangan dobel
    function requestImageGeneration(prompt, opts = {}) {
        if (!opts.skipUserTurn) {
            createBubble("user", prompt);
            chatHistory.push({ role: "user", content: prompt });
            syncActiveConversation();
        }
        setProcessing(true);
        removeWelcome();

        const div = document.createElement("div");
        div.classList.add("message", "assistant");
        const avatar = document.createElement("div");
        avatar.classList.add("message-avatar");
        avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const bodyEl = document.createElement("div");
        bodyEl.classList.add("message-body");
        const contentDiv = document.createElement("div");
        contentDiv.classList.add("message-content");
        contentDiv.innerHTML = '<div class="generated-image-loading"><div class="typing-indicator"><span></span><span></span><span></span></div><span>Lagi bikin gambar...</span></div>';
        bodyEl.appendChild(contentDiv);
        div.appendChild(avatar);
        div.appendChild(bodyEl);
        chatMessages.appendChild(div);
        scrollBottom();

        const url = buildPollinationsUrl(prompt);
        const img = new Image();
        img.onload = () => {
            contentDiv.innerHTML = "";
            const imgEl = document.createElement("img");
            imgEl.src = url;
            imgEl.alt = prompt;
            imgEl.classList.add("message-image");
            contentDiv.appendChild(imgEl);

            const actions = document.createElement("div");
            actions.classList.add("message-actions");
            const dlBtn = document.createElement("a");
            dlBtn.href = url;
            dlBtn.download = "hanekawa-image.jpg";
            dlBtn.target = "_blank";
            dlBtn.rel = "noopener";
            dlBtn.classList.add("message-action-btn");
            dlBtn.textContent = "⬇ Unduh";
            actions.appendChild(dlBtn);
            bodyEl.appendChild(actions);

            chatHistory.push({ role: "assistant", content: IMG_MARKER + url });
            syncActiveConversation();
            setProcessing(false);
            userInput.focus();
            scrollBottom();
        };
        img.onerror = () => {
            div.remove();
            setProcessing(false);
            createBubble("error", "⚠️ Gagal bikin gambar (server generator lagi sibuk atau prompt kena filter). Coba lagi ya.", { retryPrompt: prompt, isImageRetry: true });
        };
        img.src = url;
    }

    /* ========== CHAT ========== */
    function autoResize() {
        userInput.style.height = "auto";
        const newHeight = Math.min(userInput.scrollHeight, 120);
        userInput.style.height = `${newHeight}px`;
        userInput.style.overflowY = userInput.scrollHeight > 120 ? "auto" : "hidden";
    }
    userInput.addEventListener("input", autoResize);
    userInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    // Banyak keyboard mobile (mis. Gboard) tidak memicu keydown "Enter" pada <textarea>,
    // melainkan langsung menyisipkan baris baru lewat input event bertipe insertLineBreak.
    userInput.addEventListener("input", (e) => {
        if (e.inputType === "insertLineBreak") {
            userInput.value = userInput.value.replace(/\n$/, "");
            autoResize();
            sendMessage();
        }
    });
    let lastTapAction = 0;
    function debounceTap(fn) {
        return (e) => {
            const now = Date.now();
            if (now - lastTapAction < 400) return;
            lastTapAction = now;
            fn(e);
        };
    }
    btnSend.addEventListener("click", debounceTap(sendMessage));
    btnSend.addEventListener("pointerup", debounceTap((e) => { e.preventDefault(); sendMessage(); }));
    if (btnStop) {
        const stopAction = debounceTap(() => { if (activeController) activeController.abort(); });
        btnStop.addEventListener("click", stopAction);
        btnStop.addEventListener("pointerup", (e) => { e.preventDefault(); stopAction(e); });
    }

    /* ========== MULTI-PERCAKAPAN (RIWAYAT) ========== */
    const MAX_CONVERSATIONS = 50;   // batas jumlah percakapan yang disimpan
    const MAX_MESSAGES_STORED = 60; // batas pesan per percakapan yang disimpan (~30 giliran)

    function genId() {
        return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function makeTitle(text) {
        const clean = String(text || "").replace(/\s+/g, " ").trim();
        if (!clean) return "Percakapan baru";
        return clean.length > 42 ? clean.slice(0, 42).trimEnd() + "…" : clean;
    }

    function loadConversations() {
        try {
            const raw = localStorage.getItem("tazanai_conversations");
            const data = raw ? JSON.parse(raw) : [];
            conversations = Array.isArray(data) ? data : [];
        } catch { conversations = []; }
    }

    function persistConversations() {
        try {
            localStorage.setItem("tazanai_conversations", JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
        } catch { /* storage penuh/disabled, biarkan saja di memori */ }
    }

    // Migrasi dari versi lama (single-history) supaya percakapan sebelumnya tidak hilang
    function migrateOldHistory() {
        try {
            const raw = localStorage.getItem("tazanai_history");
            if (raw) {
                const data = JSON.parse(raw);
                if (Array.isArray(data) && data.length > 0) {
                    const firstUser = data.find((m) => m && m.role === "user");
                    conversations.unshift({
                        id: genId(),
                        title: makeTitle(firstUser ? firstUser.content : ""),
                        messages: data.slice(-MAX_MESSAGES_STORED),
                        updatedAt: Date.now()
                    });
                    persistConversations();
                }
            }
            localStorage.removeItem("tazanai_history");
        } catch { /* ignore */ }
    }

    function getActiveConversation() {
        return conversations.find((c) => c.id === activeConversationId) || null;
    }

    // Simpan chatHistory saat ini ke dalam daftar percakapan + urutkan berdasar terbaru
    function syncActiveConversation() {
        let conv = getActiveConversation();
        if (!conv) {
            conv = { id: activeConversationId, title: "Percakapan baru", messages: [], updatedAt: Date.now() };
            conversations.unshift(conv);
        }
        conv.messages = chatHistory.slice(-MAX_MESSAGES_STORED);
        conv.updatedAt = Date.now();
        if (!conv.title || conv.title === "Percakapan baru") {
            const firstUser = conv.messages.find((m) => m.role === "user");
            if (firstUser) conv.title = makeTitle(firstUser.content);
        }
        conversations = conversations.filter((c) => c.id !== conv.id);
        conversations.unshift(conv);
        persistConversations();
        try { localStorage.setItem("tazanai_active_id", activeConversationId); } catch { /* ignore */ }
        renderHistoryList();
        updateMemoryBadge();
    }

    function renderHistoryList() {
        if (!chatHistoryList) return;
        chatHistoryList.innerHTML = "";
        if (conversations.length === 0) {
            const empty = document.createElement("p");
            empty.classList.add("history-empty");
            empty.textContent = "Belum ada riwayat";
            chatHistoryList.appendChild(empty);
            return;
        }
        conversations.forEach((conv) => {
            const item = document.createElement("div");
            item.classList.add("chat-history-item");
            if (conv.id === activeConversationId) item.classList.add("active");

            const titleSpan = document.createElement("span");
            titleSpan.classList.add("history-item-title");
            titleSpan.textContent = conv.title || "Percakapan baru";
            item.appendChild(titleSpan);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.classList.add("history-item-delete");
            delBtn.setAttribute("aria-label", "Hapus percakapan");
            delBtn.textContent = "✕";
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
            });
            item.appendChild(delBtn);

            item.addEventListener("click", () => switchConversation(conv.id));
            chatHistoryList.appendChild(item);
        });
    }

    function renderChatFromHistory() {
        chatMessages.innerHTML = "";
        if (chatHistory.length === 0) {
            chatMessages.innerHTML = WELCOME_HTML;
            bindSuggestionChips();
            return;
        }
        for (const msg of chatHistory) {
            if (msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string") {
                createBubble(msg.role, msg.content);
            }
        }
    }

    function switchConversation(id) {
        if (id === activeConversationId) { if (!isDesktop()) closeSidebar(); return; }
        if (activeController) activeController.abort();
        const conv = conversations.find((c) => c.id === id);
        if (!conv) return;
        activeConversationId = id;
        chatHistory = conv.messages.slice();
        lastFailedPrompt = null;
        try { localStorage.setItem("tazanai_active_id", activeConversationId); } catch { /* ignore */ }
        renderChatFromHistory();
        renderHistoryList();
        updateMemoryBadge();
        if (!isDesktop()) closeSidebar();
    }

    function deleteConversation(id) {
        conversations = conversations.filter((c) => c.id !== id);
        persistConversations();
        if (id === activeConversationId) {
            if (conversations.length > 0) {
                switchConversation(conversations[0].id);
            } else {
                startNewConversation(true);
            }
        } else {
            renderHistoryList();
        }
    }

    // Mulai percakapan baru TANPA menghapus riwayat percakapan yang sudah ada
    function startNewConversation(skipCloseSidebar) {
        if (activeController) activeController.abort();
        activeConversationId = genId();
        chatHistory = [];
        lastFailedPrompt = null;
        try { localStorage.setItem("tazanai_active_id", activeConversationId); } catch { /* ignore */ }
        chatMessages.innerHTML = WELCOME_HTML;
        bindSuggestionChips();
        if (typeof gsap !== "undefined") gsap.from("#welcomeMessage", { opacity: 0, y: 20, duration: 0.5, ease: "power2.out" });
        renderHistoryList();
        updateMemoryBadge();
        if (!skipCloseSidebar && !isDesktop()) closeSidebar();
    }

    function updateMemoryBadge() {
        if (!memoryInfo || !memoryCount) return;
        if (chatHistory.length > 0) {
            memoryInfo.style.display = "flex";
            memoryCount.textContent = `${chatHistory.length} pesan`;
        } else {
            memoryInfo.style.display = "none";
        }
    }

    function initHistory() {
        loadConversations();
        migrateOldHistory();
        const savedActiveId = (() => { try { return localStorage.getItem("tazanai_active_id"); } catch { return null; } })();
        if (savedActiveId && conversations.find((c) => c.id === savedActiveId)) {
            activeConversationId = savedActiveId;
        } else if (conversations.length > 0) {
            activeConversationId = conversations[0].id;
        } else {
            activeConversationId = genId();
        }
        const conv = conversations.find((c) => c.id === activeConversationId);
        chatHistory = conv ? conv.messages.slice() : [];
        renderChatFromHistory();
        renderHistoryList();
        updateMemoryBadge();
    }

    if (btnClear) btnClear.addEventListener("click", () => startNewConversation());
    if (btnClearTop) btnClearTop.addEventListener("click", () => startNewConversation());

    function bindSuggestionChips() {
        document.querySelectorAll(".suggestion-chip").forEach((chip) => {
            chip.addEventListener("click", () => {
                userInput.value = chip.dataset.prompt || "";
                autoResize();
                sendMessage();
            });
        });
    }
    bindSuggestionChips();

    function removeWelcome() {
        const wm = document.getElementById("welcomeMessage");
        if (!wm) return;
        if (typeof gsap !== "undefined") {
            gsap.to(wm, { opacity: 0, y: -20, duration: 0.25, ease: "power2.in", onComplete: () => wm.remove() });
        } else {
            wm.remove();
        }
    }

    function copyToClipboard(text, btn) {
        const done = () => {
            const original = btn.dataset.label || "Salin";
            btn.textContent = "✓ Disalin";
            setTimeout(() => { btn.textContent = original; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, cb) {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            cb();
        } catch { /* clipboard unavailable, silently ignore */ }
    }

    /**
     * role: "user" | "assistant" | "error"
     * rawContent: original text (used for copy / retry), content: rendered text
     */
    function createBubble(role, content, opts = {}) {
        removeWelcome();
        const isError = role === "error";
        const bubbleRole = isError ? "assistant" : role;
        const isGeneratedImage = typeof content === "string" && content.startsWith(IMG_MARKER);

        const div = document.createElement("div");
        div.classList.add("message", bubbleRole);
        if (isError) div.classList.add("error");

        const avatar = document.createElement("div");
        avatar.classList.add("message-avatar");
        avatar.innerHTML = bubbleRole === "user"
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        const body = document.createElement("div");
        body.classList.add("message-body");

        if (opts.imageUrl) {
            const userImg = document.createElement("img");
            userImg.src = opts.imageUrl;
            userImg.alt = "Gambar dari kamu";
            userImg.classList.add("message-image");
            body.appendChild(userImg);
        }

        const contentDiv = document.createElement("div");
        contentDiv.classList.add("message-content");
        if (isGeneratedImage) {
            const url = content.slice(IMG_MARKER.length);
            const imgEl = document.createElement("img");
            imgEl.src = url;
            imgEl.alt = "Gambar hasil AI";
            imgEl.classList.add("message-image");
            contentDiv.appendChild(imgEl);
        } else {
            contentDiv.innerHTML = renderMarkdown(content);
        }
        body.appendChild(contentDiv);

        if (bubbleRole === "assistant" && isGeneratedImage && !isError) {
            const actions = document.createElement("div");
            actions.classList.add("message-actions");
            const dlBtn = document.createElement("a");
            dlBtn.href = content.slice(IMG_MARKER.length);
            dlBtn.download = "hanekawa-image.jpg";
            dlBtn.target = "_blank";
            dlBtn.rel = "noopener";
            dlBtn.classList.add("message-action-btn");
            dlBtn.textContent = "⬇ Unduh";
            actions.appendChild(dlBtn);
            body.appendChild(actions);
        } else if (bubbleRole === "assistant") {
            const actions = document.createElement("div");
            actions.classList.add("message-actions");

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.classList.add("message-action-btn");
            copyBtn.dataset.label = "Salin";
            copyBtn.textContent = "Salin";
            copyBtn.addEventListener("click", () => copyToClipboard(content, copyBtn));
            actions.appendChild(copyBtn);

            if (isError && opts.retryPrompt) {
                const retryBtn = document.createElement("button");
                retryBtn.type = "button";
                retryBtn.classList.add("message-action-btn");
                retryBtn.textContent = "↻ Coba lagi";
                retryBtn.addEventListener("click", () => {
                    div.remove();
                    if (opts.isImageRetry) {
                        requestImageGeneration(opts.retryPrompt, { skipUserTurn: true });
                    } else {
                        sendMessage(opts.retryPrompt, { skipUserBubble: true, skipHistoryPush: true });
                    }
                });
                actions.appendChild(retryBtn);
            }
            body.appendChild(actions);
        }

        div.appendChild(avatar);
        div.appendChild(body);
        chatMessages.appendChild(div);
        if (typeof gsap !== "undefined") gsap.from(div, { opacity: 0, y: 16, duration: 0.3, ease: "power2.out" });
        scrollBottom();
        return contentDiv;
    }

    function addTyping() {
        removeWelcome();
        const div = document.createElement("div");
        div.classList.add("message", "assistant");
        div.id = "typingMessage";
        const avatar = document.createElement("div");
        avatar.classList.add("message-avatar");
        avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const content = document.createElement("div");
        content.classList.add("message-content");
        content.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        div.appendChild(avatar);
        div.appendChild(content);
        chatMessages.appendChild(div);
        scrollBottom();
    }

    function removeTyping() { const el = document.getElementById("typingMessage"); if (el) el.remove(); }
    function scrollBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

    function setProcessing(active) {
        isProcessing = active;
        btnSend.disabled = active;
        if (btnStop) btnStop.hidden = !active;
        btnSend.hidden = active;
    }

    /**
     * promptOverride: dipakai saat retry
     * options.skipUserBubble: jangan render ulang bubble user (dipakai retry, bubble lama sudah ada)
     * options.skipHistoryPush: jangan push ulang pesan user ke chatHistory (dipakai retry)
     */
    async function sendMessage(promptOverride, options = {}) {
        const prompt = (promptOverride !== undefined ? promptOverride : userInput.value).trim();

        // Mode "buat gambar": teks yang diketik jadi prompt generate gambar, gak lewat chat API sama sekali
        if (imageGenMode && promptOverride === undefined) {
            if (!prompt || isProcessing) return;
            userInput.value = "";
            userInput.style.height = "auto";
            userInput.style.overflowY = "hidden";
            requestImageGeneration(prompt);
            return;
        }

        const imageToSend = promptOverride === undefined ? pendingImage : null;
        if ((!prompt && !imageToSend) || isProcessing) return;

        // History yang dikirim ke backend = riwayat SEBELUM pesan ini. Backend yang akan
        // menambahkan pesan user saat ini sendiri, jadi tidak pernah bergantung urutan push di sini.
        const historyBeforeThisTurn = chatHistory.slice(-40);

        setProcessing(true);
        if (promptOverride === undefined) {
            userInput.value = "";
            userInput.style.height = "auto";
            userInput.style.overflowY = "hidden";
        }

        if (!options.skipUserBubble) createBubble("user", prompt || "🖼️ (gambar tanpa keterangan)", { imageUrl: imageToSend });
        if (!options.skipHistoryPush) {
            // Gambar asli TIDAK disimpan ke riwayat/localStorage (biar gak jebol kuota storage),
            // cukup ditandai teks placeholder-nya aja.
            const historyText = imageToSend ? `${prompt} [📷 gambar dilampirkan]`.trim() : prompt;
            chatHistory.push({ role: "user", content: historyText });
            syncActiveConversation();
        }
        if (imageToSend) clearPendingImage();

        addTyping();

        const controller = new AbortController();
        activeController = controller;
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, image: imageToSend || undefined, history: historyBeforeThisTurn }),
                signal: controller.signal
            });
            clearTimeout(timeout);
            removeTyping();

            let data = null;
            try { data = await response.json(); } catch { /* non-JSON response */ }

            if (!response.ok && !data) {
                createBubble("error", `⚠️ Server error (${response.status}). Coba lagi ya.`, { retryPrompt: prompt });
                lastFailedPrompt = prompt;
                return;
            }

            const rawReply = data?.reply || "Tidak ada respon.";
            // Jaring pengaman: buang awalan "hanekawa:" / "hanekawa ai:" kalau model masih kebiasaan nulis nama sendiri
            const reply = rawReply.replace(/^\s*hanekawa(\s*ai)?\s*:\s*/i, "");
            const isErrorReply = Boolean(data?.code) && data.code !== undefined && !response.ok
                ? true
                : /^(⚠️|🔑|🚦|🛠️|⏰|📡)/.test(reply);

            if (isErrorReply) {
                createBubble("error", reply, { retryPrompt: prompt });
                lastFailedPrompt = prompt;
            } else {
                createBubble("assistant", reply);
                chatHistory.push({ role: "assistant", content: reply });
                syncActiveConversation();
                lastFailedPrompt = null;
            }
            scrollBottom();
        } catch (e) {
            clearTimeout(timeout);
            removeTyping();
            const msg = e.name === "AbortError" ? "⏰ Dihentikan / waktu habis." : "📡 Gagal terhubung ke server.";
            createBubble("error", msg, { retryPrompt: prompt });
            lastFailedPrompt = prompt;
            scrollBottom();
        } finally {
            activeController = null;
            setProcessing(false);
            userInput.focus();
        }
    }

    initHistory();
    if (typeof window.matchMedia === "function" && !window.matchMedia("(max-width: 480px)").matches) {
        userInput.focus();
    }

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => navigator.serviceWorker.register("/static/sw.js").catch(() => {}));
    }

    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBanner) {
            installBanner.style.display = "block";
            if (typeof gsap !== "undefined") gsap.from(installBanner, { y: 100, opacity: 0, duration: 0.4, ease: "power2.out" });
        }
    });
    if (btnInstall) btnInstall.addEventListener("click", async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === "accepted" && installBanner) installBanner.style.display = "none";
        deferredPrompt = null;
    });
    if (btnDismiss) btnDismiss.addEventListener("click", () => {
        if (!installBanner) return;
        if (typeof gsap !== "undefined") {
            gsap.to(installBanner, { y: 100, opacity: 0, duration: 0.25, ease: "power2.in", onComplete: () => installBanner.style.display = "none" });
        } else {
            installBanner.style.display = "none";
        }
    });
    window.addEventListener("appinstalled", () => { if (installBanner) installBanner.style.display = "none"; });

    if (typeof gsap !== "undefined") {
        gsap.from(".welcome-message", { opacity: 0, y: 24, duration: 0.6, ease: "power2.out" });
        gsap.from(".top-bar", { y: -40, opacity: 0, duration: 0.5, ease: "power2.out" });
        gsap.from(".chat-input-area", { y: 40, opacity: 0, duration: 0.5, delay: 0.15, ease: "power2.out" });
    }
})();
