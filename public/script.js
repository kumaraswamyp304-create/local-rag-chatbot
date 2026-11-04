
/* ==========================================
   LOCAL AI CHATBOT - SSE STREAMING VERSION
========================================== */

const chat = document.getElementById("chat");
const questionInput = document.getElementById("question");
const sendBtn = document.getElementById("sendBtn");
const welcomeScreen = document.getElementById("welcomeScreen");

const conversationHistory = [];
let activeDocumentSource =
    sessionStorage.getItem("activeDocumentSource") || "all";

// ==========================================
// BACKEND CONFIGURATION
// ==========================================

const BACKEND_URL = "https://blvd-diffs-knights-accordance.trycloudflare.com";

const STREAM_URL = `${BACKEND_URL}/local/rag-chat/stream`;

// ==========================================
// CHAT ACCESS PASSWORD
// ==========================================

function getChatAccessToken() {
    let token = sessionStorage.getItem("chatAccessToken");

    if (!token) {
        token = prompt("Enter chatbot access password:");

        if (!token || !token.trim()) {
            throw new Error("Chatbot access password is required.");
        }

        token = token.trim();
        sessionStorage.setItem("chatAccessToken", token);
    }

    return token;
}

// ==========================================
// ESCAPE HTML
// ==========================================

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
}

// ==========================================
// MARKDOWN RENDERING
// ==========================================

function renderMarkdown(text) {
    if (!text) return "";

    if (typeof marked === "undefined") {
        return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    }

    let content = String(text).trim();

    const outerFence = content.match(
        /^```(?:markdown|md|text)\s*\r?\n([\s\S]*?)\r?\n```\s*$/i
    );

    if (outerFence) {
        content = outerFence[1].trim();
    }

    const html = marked.parse(content, {
        gfm: true,
        breaks: true
    });

    if (window.DOMPurify) {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: {
                html: true
            },
            FORBID_TAGS: [
                "script",
                "style",
                "iframe",
                "object",
                "embed",
                "form"
            ]
        });
    }

    return `<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`;
}

// ==========================================
// MARKDOWN TO PLAIN TEXT
// ==========================================

function markdownToText(markdown) {
    const element = document.createElement("div");

    element.innerHTML = renderMarkdown(markdown);

    return element.textContent || "";
}

// ==========================================
// VALIDATE REFERENCE URL
// ==========================================

function validateReferenceUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    try {
        const url = new URL(value);

        if (!["http:", "https:"].includes(url.protocol)) {
            return null;
        }

        return url.href;

    } catch {
        return null;
    }
}

// ==========================================
// DISPLAY REFERENCES
// ==========================================

function addReferences(messageContent, sources = []) {
    if (!Array.isArray(sources)) return;

    const uniqueSources = new Map();

    for (const source of sources) {
        if (!source || typeof source !== "object") continue;

        const url = validateReferenceUrl(source.url);

        if (!url) continue;

        if (!uniqueSources.has(url)) {
            uniqueSources.set(url, {
                title: source.title || source.source || "Reference",
                url
            });
        }
    }

    if (uniqueSources.size === 0) return;

    const referenceContainer = document.createElement("section");
    referenceContainer.className = "message-references";

    const heading = document.createElement("h4");
    heading.textContent = "References";

    referenceContainer.appendChild(heading);

    const list = document.createElement("ul");

    for (const source of uniqueSources.values()) {
        const item = document.createElement("li");
        const link = document.createElement("a");

        link.href = source.url;
        link.textContent = source.title;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        item.appendChild(link);
        list.appendChild(item);
    }

    referenceContainer.appendChild(list);
    messageContent.appendChild(referenceContainer);
}

// ==========================================
// CREATE MESSAGE
// ==========================================

function createMessage(role) {
    if (welcomeScreen) {
        welcomeScreen.style.display = "none";
    }

    const message = document.createElement("article");

    message.className =
        role === "user"
            ? "message user-message"
            : "message ai-message";

    const header = document.createElement("div");

    header.className = "message-header";

    header.textContent =
        role === "user"
            ? "You"
            : "🤖 Assistant";

    const body = document.createElement("div");

    body.className = "message-content";

    if (role === "ai") {
        body.classList.add("markdown-content");
    }

    message.appendChild(header);
    message.appendChild(body);

    chat.appendChild(message);

    chat.scrollTop = chat.scrollHeight;

    return {
        message,
        body
    };
}

// ==========================================
// ADD MESSAGE
// ==========================================

function addMessage(role, content, sources = []) {
    const result = createMessage(role);

    if (role === "user") {
        result.body.textContent = content || "";
    } else {
        result.body.innerHTML = renderMarkdown(content);
        addReferences(result.body, sources);
    }

    chat.scrollTop = chat.scrollHeight;

    return result.message;
}

// ==========================================
// LOADING INDICATOR
// ==========================================

function showLoading() {
    const result = createMessage("ai");

    result.body.innerHTML = `
        <div class="loading-dots" aria-label="Assistant is thinking">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;

    return result.message;
}

// ==========================================
// PROCESS SSE EVENT
// ==========================================

function processSSEEvent(eventBlock, state) {
    const lines = eventBlock.split(/\r?\n/);

    let eventName = "message";
    const dataLines = [];

    for (const line of lines) {
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
        }
    }

    if (dataLines.length === 0) return;

    let data;

    try {
        data = JSON.parse(dataLines.join("\n"));
    } catch (error) {
        console.error("Invalid SSE data:", error);
        return;
    }

    // Incoming generated token
    if (eventName === "token") {
        const token = data.content || "";

        state.answer += token;

        // Display incoming text immediately
        state.messageContent.textContent = state.answer;

        chat.scrollTop = chat.scrollHeight;
    }

    // Completed answer
    if (eventName === "complete") {
        state.completed = true;

        if (typeof data.answer === "string") {
            state.answer = data.answer;
        }

        state.sources = Array.isArray(data.sources)
            ? data.sources
            : [];
    }

    // Server-side error
    if (eventName === "error") {
        state.error = data.error || "Streaming failed.";
    }
}

// ==========================================
// SEND MESSAGE - STREAMING
// ==========================================

async function sendMessage() {
    const question = questionInput.value.trim();

    if (!question || sendBtn.disabled) return;

    // Display user question
    addMessage("user", question);

    questionInput.value = "";

    sendBtn.disabled = true;
    sendBtn.textContent = "…";

    const loading = showLoading();

    let assistant = null;

    try {
        const response = await fetch(STREAM_URL, {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getChatAccessToken()}`
            },

            body: JSON.stringify({
                question,
                source: activeDocumentSource,
                messages: conversationHistory
            })
        });

        // Handle HTTP errors before reading SSE
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            // Ask for the password again if it is incorrect
            if (response.status === 401) {
                sessionStorage.removeItem("chatAccessToken");
            }

            throw new Error(
                errorData.error ||
                errorData.message ||
                `Request failed: ${response.status}`
            );
        }

        if (!response.body) {
            throw new Error(
                "Streaming is not supported by this browser."
            );
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("text/event-stream")) {
            throw new Error(
                "The server did not return an SSE response."
            );
        }

        // Create assistant message
        assistant = createMessage("ai");

        loading.remove();

        const state = {
            answer: "",
            sources: [],
            completed: false,
            error: null,
            messageContent: assistant.body
        };

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        // Read incoming response chunks
        while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, {
                stream: true
            });

            const events = buffer.split(/\r?\n\r?\n/);

            buffer = events.pop() || "";

            for (const eventBlock of events) {
                processSSEEvent(eventBlock, state);
            }

            if (state.error) {
                throw new Error(state.error);
            }
        }

        // Process remaining decoder data
        buffer += decoder.decode();

        if (buffer.trim()) {
            processSSEEvent(buffer, state);
        }

        if (state.error) {
            throw new Error(state.error);
        }

        if (!state.completed) {
            throw new Error(
                "The streaming response ended unexpectedly."
            );
        }

        // Final Markdown rendering
        const finalAnswer =
            state.answer.trim() ||
            "I couldn't generate an answer.";

        assistant.body.innerHTML = renderMarkdown(finalAnswer);

        // Display references after generation
        addReferences(
            assistant.body,
            state.sources
        );

        // Save conversation history
        conversationHistory.push(
            {
                role: "user",
                content: question
            },
            {
                role: "assistant",
                content: markdownToText(finalAnswer)
            }
        );

        // Keep latest 10 messages
        if (conversationHistory.length > 10) {
            conversationHistory.splice(
                0,
                conversationHistory.length - 10
            );
        }

        chat.scrollTop = chat.scrollHeight;

    } catch (error) {
        console.error("STREAMING CHAT ERROR:", error);

        loading.remove();

        if (assistant) {
            assistant.message.remove();
        }

        addMessage(
            "ai",
            `Sorry, I encountered an error: ${error.message}`
        );

    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "➤";

        questionInput.focus();
    }
}

// ==========================================
// ENTER KEY
// ==========================================

questionInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

// ==========================================
// SEND BUTTON
// ==========================================

sendBtn.addEventListener("click", sendMessage);

// ==========================================
// PDF UPLOAD
// ==========================================

const pdfFileInput = document.getElementById("pdfFile");
const uploadPdfBtn = document.getElementById("uploadPdfBtn");
const selectedFileName = document.getElementById("selectedFileName");
const uploadStatus = document.getElementById("uploadStatus");

const PDF_UPLOAD_URL = `${BACKEND_URL}/local/upload-pdf`;

if (
    pdfFileInput &&
    uploadPdfBtn &&
    selectedFileName &&
    uploadStatus
) {
    // Open PDF file selector
    uploadPdfBtn.addEventListener("click", () => {
        pdfFileInput.click();
    });

    // Upload selected PDF
    pdfFileInput.addEventListener("change", async () => {
        const file = pdfFileInput.files[0];

        if (!file) return;

        // Validate PDF extension
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            uploadStatus.textContent = "Please select a PDF file.";
            uploadStatus.className = "upload-status error";
            pdfFileInput.value = "";
            return;
        }

        // Backend currently supports a maximum of 10 MB
        if (file.size > 10 * 1024 * 1024) {
            uploadStatus.textContent = "PDF size must not exceed 10 MB.";
            uploadStatus.className = "upload-status error";
            pdfFileInput.value = "";
            return;
        }

        selectedFileName.textContent = file.name;

        uploadPdfBtn.disabled = true;
        uploadStatus.textContent = "Uploading and processing PDF...";
        uploadStatus.className = "upload-status";

        try {
            const formData = new FormData();

            formData.append("pdf", file);

            const response = await fetch(PDF_UPLOAD_URL, {
                method: "POST",

                headers: {
                    "Authorization": `Bearer ${getChatAccessToken()}`
                },

                body: formData
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (response.status === 401) {
                    sessionStorage.removeItem("chatAccessToken");
                }

                throw new Error(
                    result.error || `Upload failed: ${response.status}`
                );
            }

            // Make this PDF the active source for chat questions
activeDocumentSource = file.name;

sessionStorage.setItem(
    "activeDocumentSource",
    activeDocumentSource
);

uploadStatus.textContent =
    `✓ ${file.name} uploaded and indexed successfully. Questions will now use this PDF.`;

uploadStatus.className = "upload-status success";

console.log("PDF ingestion completed:", result);

        } catch (error) {
            console.error("PDF UPLOAD ERROR:", error);

            uploadStatus.textContent = error.message;
            uploadStatus.className = "upload-status error";

        } finally {
            uploadPdfBtn.disabled = false;

            // Allow selecting the same file again
            pdfFileInput.value = "";
        }
    });
}
