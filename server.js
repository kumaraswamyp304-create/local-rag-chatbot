require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");

const { Ollama } = require("ollama");

const {
    askRAG,
    getAvailableSources
} = require("./rag/rag");

const { ingestPDF } = require("./rag/ingest");
const { ingestWebsite } = require("./rag/ingestWeb");
const { validateApiKey } = require("./auth/apiKeys");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const IS_DEVELOPMENT =
    process.env.NODE_ENV !== "production";

const LOCAL_TENANT = "default";

// ==========================================
// GENERAL MIDDLEWARE
// ==========================================

app.use(cors({
    origin: "https://demochatbot2.netlify.app",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({
    limit: "1mb"
}));

app.use(express.static(
    path.join(__dirname, "public")
));

// ==========================================
// API KEY AUTHENTICATION
// ==========================================

function resolveTenant(req, res, next) {
    const authorization = req.get("Authorization");

    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {
        return res.status(401).json({
            error: "API key is required."
        });
    }

    const apiKey = authorization.slice(7).trim();
    const tenantId = validateApiKey(apiKey);

    if (!tenantId) {
        return res.status(401).json({
            error: "Invalid or inactive API key."
        });
    }

    req.tenantId = tenantId;
    next();
}

// ==========================================
// LOCAL DEVELOPMENT TENANT
// ==========================================

function resolveLocalTenant(req, res, next) {
    if (!IS_DEVELOPMENT) {
        return res.status(403).json({
            error: "Local development routes are disabled."
        });
    }

    req.tenantId = LOCAL_TENANT;
    next();
}

// ==========================================
// SHARED FRIEND ACCESS AUTHENTICATION
// ==========================================

const CHAT_ACCESS_TOKEN = process.env.CHAT_ACCESS_TOKEN;

function requireSharedToken(req, res, next) {
    if (!CHAT_ACCESS_TOKEN) {
        return res.status(500).json({
            error: "Chat access password is not configured."
        });
    }

    const authorization = req.get("Authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Please enter the chatbot access password."
        });
    }

    const suppliedToken = authorization.slice(7).trim();

    const expected = Buffer.from(CHAT_ACCESS_TOKEN);
    const supplied = Buffer.from(suppliedToken);

    if (
        supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)
    ) {
        return res.status(401).json({
            error: "Incorrect chatbot access password."
        });
    }

    next();
}

// ==========================================
// OLLAMA CONFIGURATION
// ==========================================

const ollama = new Ollama({
    host: "http://127.0.0.1:11434"
});

const systemMessage = {
    role: "system",
    content: `
You are a helpful conversational AI assistant.

Use the conversation history to understand context.

If the user provides information during the conversation,
you may use that information in later messages.

Answer naturally and directly.
`
};

// ==========================================
// RAG STREAMING HANDLER
// SSE RESPONSE
// ==========================================

async function streamRagResponse(req, res, tenantId) {
    const {
        question,
        source = "all",
        messages = []
    } = req.body;

    if (
        typeof question !== "string" ||
        !question.trim()
    ) {
        return res.status(400).json({
            error: "Question is required."
        });
    }

    if (!Array.isArray(messages)) {
        return res.status(400).json({
            error: "Messages must be an array."
        });
    }

    console.log("\n========== RAG STREAMING CHAT ==========");
    console.log("Tenant:", tenantId);
    console.log("Question:", question);

    res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    });

    res.flushHeaders();

    let clientDisconnected = false;

    res.on("close", () => {
        if (!res.writableEnded) {
            clientDisconnected = true;
            console.log("Streaming client disconnected.");
        }
    });

    function sendEvent(eventName, data) {
        if (
            clientDisconnected ||
            res.destroyed ||
            res.writableEnded
        ) {
            return false;
        }

        res.write(
            `event: ${eventName}\n` +
            `data: ${JSON.stringify(data)}\n\n`
        );

        return true;
    }

    try {
        console.log("Starting RAG generation...");

        const result = await askRAG(
            question,
            source,
            messages,
            tenantId,
            (token) => {
                const sent = sendEvent("token", {
                    content: token
                });

                if (sent) {
                    console.log("Token received:", token);
                }
            }
        );

        console.log("RAG generation completed.");
        console.log(
            "Answer length:",
            result.answer?.length || 0
        );

        sendEvent("complete", {
            answer: result.answer,
            sources: result.sources || []
        });

        if (!res.writableEnded && !res.destroyed) {
            res.end();
        }

    } catch (error) {
        console.error("RAG STREAM ERROR:", error);

        sendEvent("error", {
            error: error.message || "Streaming failed."
        });

        if (!res.writableEnded && !res.destroyed) {
            res.end();
        }
    }
}

// ==========================================
// PDF UPLOAD CONFIGURATION
// ==========================================

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, {
        recursive: true
    });
}

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        try {
            const tenantUploadDir = path.join(
                uploadDir,
                req.tenantId
            );

            fs.mkdirSync(tenantUploadDir, {
                recursive: true
            });

            cb(null, tenantUploadDir);

        } catch (error) {
            cb(error);
        }
    },

    filename: function (req, file, cb) {
        const extension = path.extname(
            file.originalname
        ).toLowerCase();

        cb(
            null,
            `${crypto.randomUUID()}${extension}`
        );
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {
        const extension = path.extname(
            file.originalname
        ).toLowerCase();

        if (extension !== ".pdf") {
            return cb(
                new Error("Only PDF files are allowed.")
            );
        }

        cb(null, true);
    }
});
// ==========================================
// NORMAL CHAT
// NDJSON STREAMING
// ==========================================

app.post("/chat", requireSharedToken, async (req, res) => {
    try {
        const { messages } = req.body;

        if (
            !Array.isArray(messages) ||
            messages.length === 0
        ) {
            return res.status(400).json({
                error: "Messages are required."
            });
        }

        console.log("\n========== NORMAL CHAT ==========");

        const ollamaMessages = [
            systemMessage,
            ...messages
        ];

        res.setHeader(
            "Content-Type",
            "application/x-ndjson"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        res.flushHeaders();

        const response = await ollama.chat({
            model: "qwen2.5:3b",
            messages: ollamaMessages,
            stream: true
        });

        for await (const chunk of response) {
            if (res.destroyed || res.writableEnded) {
                break;
            }

            const content =
                chunk.message?.content || "";

            if (content) {
                res.write(
                    JSON.stringify({
                        content
                    }) + "\n"
                );
            }
        }

        if (!res.destroyed && !res.writableEnded) {
            res.end();
        }

    } catch (error) {
        console.error("CHAT ERROR:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: error.message
            });
        } else if (!res.destroyed && !res.writableEnded) {
            res.end();
        }
    }
});

// ==========================================
// AUTHENTICATED RAG CHAT
// NORMAL JSON RESPONSE
// ==========================================

app.post(
    "/rag-chat",
    resolveTenant,
    async (req, res) => {
        try {
            const {
                question,
                source = "all",
                messages = []
            } = req.body;

            if (
                typeof question !== "string" ||
                !question.trim()
            ) {
                return res.status(400).json({
                    error: "Question is required."
                });
            }

            if (!Array.isArray(messages)) {
                return res.status(400).json({
                    error: "Messages must be an array."
                });
            }

            console.log(
                "\n========== AUTHENTICATED RAG CHAT =========="
            );

            console.log("Tenant:", req.tenantId);
            console.log("Question:", question);

            const result = await askRAG(
                question,
                source,
                messages,
                req.tenantId
            );

            res.json({
                answer: result.answer,
                sources: result.sources
            });

        } catch (error) {
            console.error("RAG ERROR:", error);

            res.status(500).json({
                error: error.message
            });
        }
    }
);

// ==========================================
// AUTHENTICATED RAG STREAMING
// SSE RESPONSE
// ==========================================

app.post(
    "/rag-chat/stream",
    resolveTenant,
    async (req, res) => {
        await streamRagResponse(
            req,
            res,
            req.tenantId
        );
    }
);

// ==========================================
// AUTHENTICATED SOURCE LIST
// ==========================================

app.get(
    "/rag-sources",
    resolveTenant,
    (req, res) => {
        try {
            const sources = getAvailableSources(
                req.tenantId
            );

            res.json({
                sources
            });

        } catch (error) {
            console.error("SOURCE ERROR:", error);

            res.status(500).json({
                error: error.message
            });
        }
    }
);

// ==========================================
// AUTHENTICATED PDF UPLOAD
// ==========================================

app.post(
    "/upload-pdf",
    resolveTenant,
    upload.single("pdf"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: "PDF file is required."
                });
            }

            console.log("\n========== PDF UPLOAD ==========");
            console.log("Tenant:", req.tenantId);
            console.log("File:", req.file.originalname);

            const result = await ingestPDF(
                req.file.path,
                req.file.originalname,
                req.tenantId
            );

            res.json({
                success: true,
                message: "PDF uploaded and indexed successfully.",
                tenantId: req.tenantId,
                fileName: req.file.originalname,
                result
            });

        } catch (error) {
            console.error("UPLOAD ERROR:", error);

            res.status(500).json({
                error: error.message
            });
        }
    }
);

// ==========================================
// AUTHENTICATED WEBSITE INGESTION
// ==========================================

app.post(
    "/ingest-website",
    resolveTenant,
    async (req, res) => {
        try {
            const {
                sitemapUrl,
                maxPages = 5
            } = req.body;

            if (
                typeof sitemapUrl !== "string" ||
                !sitemapUrl.trim()
            ) {
                return res.status(400).json({
                    error: "A valid sitemapUrl is required."
                });
            }

            let parsedUrl;

            try {
                parsedUrl = new URL(sitemapUrl);
            } catch {
                return res.status(400).json({
                    error: "Invalid sitemap URL."
                });
            }

            if (
                !["http:", "https:"].includes(parsedUrl.protocol)
            ) {
                return res.status(400).json({
                    error: "Only HTTP and HTTPS URLs are allowed."
                });
            }

            if (
                !Number.isInteger(maxPages) ||
                maxPages < 1 ||
                maxPages > 50
            ) {
                return res.status(400).json({
                    error: "maxPages must be between 1 and 50."
                });
            }

            console.log(
                "\n========== WEBSITE INGESTION =========="
            );

            console.log("Tenant:", req.tenantId);
            console.log("Sitemap:", sitemapUrl);

            const result = await ingestWebsite(
                sitemapUrl,
                {
                    tenantId: req.tenantId,
                    maxPages
                }
            );

            res.json({
                success: true,
                message: "Website ingestion completed.",
                ...result
            });

        } catch (error) {
            console.error(
                "WEBSITE INGESTION ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

// ==========================================
// SHARED PASSWORD PROTECTION FOR LOCAL ROUTES
// ==========================================

app.use("/local", requireSharedToken);
// ==========================================
// LOCAL CHATBOT RAG
// DEVELOPMENT ONLY
// NORMAL JSON RESPONSE
// ==========================================

if (IS_DEVELOPMENT) {

    app.post(
        "/local/rag-chat",
        resolveLocalTenant,
        async (req, res) => {
            try {
                const {
                    question,
                    source = "all",
                    messages = []
                } = req.body;

                if (
                    typeof question !== "string" ||
                    !question.trim()
                ) {
                    return res.status(400).json({
                        error: "Question is required."
                    });
                }

                if (!Array.isArray(messages)) {
                    return res.status(400).json({
                        error: "Messages must be an array."
                    });
                }

                console.log(
                    "\n========== LOCAL RAG CHAT =========="
                );

                console.log("Tenant:", req.tenantId);
                console.log("Question:", question);

                const result = await askRAG(
                    question,
                    source,
                    messages,
                    req.tenantId
                );

                res.json({
                    answer: result.answer,
                    sources: result.sources
                });

            } catch (error) {
                console.error(
                    "LOCAL RAG ERROR:",
                    error
                );

                res.status(500).json({
                    error: error.message
                });
            }
        }
    );

    // ======================================
    // LOCAL RAG STREAMING
    // DEVELOPMENT ONLY
    // ======================================

    app.post(
        "/local/rag-chat/stream",
        resolveLocalTenant,
        async (req, res) => {
            await streamRagResponse(
                req,
                res,
                req.tenantId
            );
        }
    );

    // ======================================
    // LOCAL PDF UPLOAD
    // DEVELOPMENT ONLY
    // ======================================

    app.post(
        "/local/upload-pdf",
        resolveLocalTenant,
        upload.single("pdf"),
        async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({
                        error: "PDF file is required."
                    });
                }

                console.log(
                    "\n========== LOCAL PDF UPLOAD =========="
                );

                console.log("Tenant:", req.tenantId);
                console.log("File:", req.file.originalname);

                const result = await ingestPDF(
                    req.file.path,
                    req.file.originalname,
                    req.tenantId
                );

                res.json({
                    success: true,
                    message: "PDF uploaded and indexed successfully.",
                    tenantId: req.tenantId,
                    fileName: req.file.originalname,
                    result
                });

            } catch (error) {
                console.error(
                    "LOCAL UPLOAD ERROR:",
                    error
                );

                res.status(500).json({
                    error: error.message
                });
            }
        }
    );

    // ======================================
    // LOCAL WEBSITE INGESTION
    // DEVELOPMENT ONLY
    // ======================================

    app.post(
        "/local/ingest-website",
        resolveLocalTenant,
        async (req, res) => {
            try {
                const {
                    sitemapUrl,
                    maxPages = 5
                } = req.body;

                if (
                    typeof sitemapUrl !== "string" ||
                    !sitemapUrl.trim()
                ) {
                    return res.status(400).json({
                        error: "A valid sitemapUrl is required."
                    });
                }

                let parsedUrl;

                try {
                    parsedUrl = new URL(sitemapUrl);
                } catch {
                    return res.status(400).json({
                        error: "Invalid sitemap URL."
                    });
                }

                if (
                    !["http:", "https:"].includes(parsedUrl.protocol)
                ) {
                    return res.status(400).json({
                        error: "Only HTTP and HTTPS URLs are allowed."
                    });
                }

                if (
                    !Number.isInteger(maxPages) ||
                    maxPages < 1 ||
                    maxPages > 50
                ) {
                    return res.status(400).json({
                        error: "maxPages must be between 1 and 50."
                    });
                }

                console.log(
                    "\n========== LOCAL WEBSITE INGESTION =========="
                );

                console.log("Tenant:", req.tenantId);
                console.log("Sitemap:", sitemapUrl);

                const result = await ingestWebsite(
                    sitemapUrl,
                    {
                        tenantId: req.tenantId,
                        maxPages
                    }
                );

                res.json({
                    success: true,
                    message: "Website ingestion completed.",
                    ...result
                });

            } catch (error) {
                console.error(
                    "LOCAL WEBSITE INGESTION ERROR:",
                    error
                );

                res.status(500).json({
                    error: error.message
                });
            }
        }
    );
}

// ==========================================
// HOME
// ==========================================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {
    console.error("REQUEST ERROR:", error);

    if (res.headersSent) {
        return next(error);
    }

    const statusCode =
        error instanceof multer.MulterError
            ? 400
            : 400;

    res.status(statusCode).json({
        error: error.message || "Request failed."
    });
});

// ==========================================
// ROUTE DIAGNOSTICS
// ==========================================

console.log("\n========== REGISTERED ROUTES ==========");

console.log(
    app.router.stack
        .filter(layer => layer.route)
        .map(layer => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods)
        }))
);

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(
        `\nSERVER STARTED: http://localhost:${PORT}`
    );

    console.log("Normal chat: NDJSON streaming");
    console.log("RAG chat: JSON + SSE streaming");
    console.log("Tenant API key authentication enabled.");
    console.log("PDF ingestion enabled.");
    console.log("Website ingestion enabled.");

    if (IS_DEVELOPMENT) {
        console.log("Local development routes enabled.");
        console.log("Local tenant:", LOCAL_TENANT);
    }
});