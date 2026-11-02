
const { Ollama } = require("ollama");
const { createEmbedding } = require("./embeddings");
const { searchSimilar } = require("./search");
const { getDocuments } = require("./store");

const OLLAMA_HOST = "http://127.0.0.1:11434";
const MODEL = "qwen2.5:3b";

const ollama = new Ollama({
    host: OLLAMA_HOST
});

// ==========================================
// RAG CONFIGURATION
// ==========================================

const TOP_K = 6;

// Existing threshold for website and other documents
const MIN_RELEVANCE_SCORE = 0.55;

// Separate threshold for uploaded PDFs
const PDF_MIN_RELEVANCE_SCORE = 0.30;

const MAX_HISTORY_MESSAGES = 10;
const NEIGHBOR_WINDOW = 1;
const MAX_CONTEXT_CHUNKS = 12;

const REFUSAL_MESSAGE =
    "I couldn't find that information in the available documents.";

// ==========================================
// TENANT VALIDATION
// ==========================================

function validateTenantId(tenantId) {
    if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
    ) {
        throw new Error("A valid tenantId is required.");
    }

    return tenantId.trim();
}

// ==========================================
// CONVERSATION HISTORY
// ==========================================

function formatConversationHistory(messages = []) {
    if (!Array.isArray(messages)) {
        return "";
    }

    return messages
        .slice(-MAX_HISTORY_MESSAGES)
        .filter(message =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string"
        )
        .map(message => {
            const role =
                message.role === "user"
                    ? "User"
                    : "Assistant";

            return `${role}: ${message.content}`;
        })
        .join("\n");
}

// ==========================================
// CHECK WHETHER QUESTION NEEDS CONTEXT
// ==========================================

function needsContextualization(question) {
    const text = question.toLowerCase().trim();

    const followUpPatterns = [
        /^(what|how|why|when|where|who) about\b/,
        /^(and|also|then)\b/,
        /\b(it|its|they|them|their|this|that|these|those)\b/,
        /\b(the first|the second|the third|previous one|last one)\b/,
        /\b(more details|explain further|tell me more)\b/,
        /^(which one|what about them|how about)\b/
    ];

    return followUpPatterns.some(pattern =>
        pattern.test(text)
    );
}

// ==========================================
// CONTEXTUALIZE FOLLOW-UP QUESTION
// ==========================================

async function contextualizeQuestion(question, messages = []) {

    // Do not rewrite standalone questions.
    if (!needsContextualization(question)) {
        console.log("Standalone question:", question);
        return question;
    }

    const history = formatConversationHistory(messages);

    if (!history) {
        console.log("No conversation history. Using original question.");
        return question;
    }

    try {
        const response = await ollama.chat({
            model: MODEL,
            stream: false,

            messages: [
                {
                    role: "system",
                    content: `
Your task is to rewrite the latest user question
as a standalone question.

Use conversation history ONLY to understand references
such as:
- it
- its
- they
- them
- their
- this
- that
- the first one
- the second one

STRICT RULES:

1. Do not answer the question.
2. Do not copy previous assistant answers.
3. Do not introduce new facts.
4. Do not change the user's intent.
5. Do not add information that the user did not ask for.
6. If the reference is unclear, return the original question.
7. Keep the rewritten question short.
8. Return ONLY the rewritten question.
`
                },
                {
                    role: "user",
                    content: `
Conversation history:
${history}

Latest question:
${question}
`
                }
            ],

            options: {
                temperature: 0,
                num_predict: 100
            },

            keep_alive: "10m"
        });

        const rewritten =
            response.message?.content?.trim();

        console.log("\n========== QUESTION CONTEXTUALIZATION ==========");
        console.log("Original question:", question);
        console.log("Rewritten question:", rewritten);

        if (!rewritten) {
            return question;
        }

        // Reject unusually long rewrites.
        if (rewritten.length > question.length * 3 + 100) {
            console.log("Rewrite rejected. Using original question.");
            return question;
        }

        return rewritten;

    } catch (error) {
        console.error(
            "Question contextualization failed:",
            error.message
        );

        return question;
    }
}

// ==========================================
// GET NEIGHBORING CHUNKS
// ==========================================

function getNeighboringChunks(
    results,
    tenantId,
    windowSize = NEIGHBOR_WINDOW,
    maxChunks = MAX_CONTEXT_CHUNKS
) {
    const documents = getDocuments(tenantId)
        .filter(doc => doc.tenantId === tenantId);

    const documentMap = new Map();

    for (const doc of documents) {
        if (!doc.documentId) continue;

        if (!documentMap.has(doc.documentId)) {
            documentMap.set(doc.documentId, []);
        }

        documentMap.get(doc.documentId).push(doc);
    }

    for (const chunks of documentMap.values()) {
        chunks.sort(
            (a, b) =>
                (a.chunkIndex ?? 0) -
                (b.chunkIndex ?? 0)
        );
    }

    const selected = new Map();

    // Add matching chunks and their neighboring chunks.
    for (const result of results) {
        const documentId = result.documentId;
        const chunks = documentMap.get(documentId);

        if (!chunks) continue;

        const index = chunks.findIndex(
            chunk => chunk.id === result.id
        );

        if (index === -1) continue;

        const start = Math.max(
            0,
            index - windowSize
        );

        const end = Math.min(
            chunks.length - 1,
            index + windowSize
        );

        for (let i = start; i <= end; i++) {
            const chunk = chunks[i];

            const existing = selected.get(chunk.id);

            if (!existing) {
                selected.set(chunk.id, {
                    ...chunk,
                    score: result.score,
                    isPrimary: chunk.id === result.id
                });
            } else if (chunk.id === result.id) {
                existing.isPrimary = true;

                existing.score = Math.max(
                    existing.score || 0,
                    result.score || 0
                );
            }
        }
    }

    return Array.from(selected.values())
        .sort((a, b) => {
            if (a.isPrimary !== b.isPrimary) {
                return a.isPrimary ? -1 : 1;
            }

            if (b.score !== a.score) {
                return (b.score || 0) - (a.score || 0);
            }

            if (a.documentId !== b.documentId) {
                return String(a.documentId).localeCompare(
                    String(b.documentId)
                );
            }

            return (
                (a.chunkIndex ?? 0) -
                (b.chunkIndex ?? 0)
            );
        })
        .slice(0, maxChunks);
}

// ==========================================
// VALIDATE SOURCE URL
// ==========================================

function getSafeUrl(value) {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        return null;
    }

    try {
        const url = new URL(value);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return null;
        }

        return url.href;

    } catch {
        return null;
    }
}

// ==========================================
// BUILD REFERENCES
// ==========================================

function buildSources(results) {
    const sources = [];
    const seen = new Set();

    for (const result of results) {
        const url = getSafeUrl(
            result.url || result.canonicalUrl
        );

        // Local PDFs may not have URLs.
        if (!url || seen.has(url)) continue;

        seen.add(url);

        sources.push({
            title:
                result.title ||
                result.source ||
                "Reference",

            source: result.source || "",
            url
        });
    }

    return sources;
}

// ==========================================
// BUILD DOCUMENT CONTEXT
// ==========================================

function buildContext(results) {
    return results
        .map((result, index) => {
            return `
[Document ${index + 1}]
Source: ${result.source || "Unknown"}
Source type: ${result.sourceType || "Unknown"}
Title: ${result.title || "Untitled"}
URL: ${result.url || result.canonicalUrl || "Not available"}
Chunk: ${result.chunkIndex ?? "Unknown"}

Content:
${result.text || ""}
`;
        })
        .join("\n--------------------\n");
}

// ==========================================
// GET AVAILABLE SOURCES
// ==========================================

function getAvailableSources(tenantId) {
    tenantId = validateTenantId(tenantId);

    const documents = getDocuments(tenantId)
        .filter(doc => doc.tenantId === tenantId);

    const sources = [
        ...new Set(
            documents
                .map(doc => doc.source)
                .filter(Boolean)
        )
    ];

    return sources;
}

// ==========================================
// GENERAL CAPABILITY QUESTIONS
// ==========================================

function getCapabilityResponse(question, tenantId) {
    const text = question.toLowerCase().trim();

    const capabilityPatterns = [
        /^how can you help me\??$/,
        /^what can you do\??$/,
        /^how do you work\??$/,
        /^what are your capabilities\??$/,
        /^what can i ask you\??$/
    ];

    const isCapabilityQuestion =
        capabilityPatterns.some(pattern =>
            pattern.test(text)
        );

    if (isCapabilityQuestion) {
        return `I can help you find and understand information
from the documents available in my knowledge base.

Here are some things you can ask me:

- **Find information:** Ask questions about projects,
  products, services, and business activities.
- **Summarize documents:** Get concise summaries of
  information available in the documents.
- **Extract details:** Find specific dates, names,
  project details, and other information.
- **Compare information:** Compare details across
  different documents when the documents support it.
- **Answer follow-up questions:** Ask additional
  questions about information discussed earlier.

For example, you can ask:

- What information is available about L&T projects?
- Which countries are mentioned in the projects?
- What contracts has L&T received?
- Give me a summary of the Heavy Engineering business.

I will base document-related answers only on the
information available in my knowledge base.`;
    }

    // ======================================
    // WHAT INFORMATION DO YOU HAVE?
    // ======================================

    const informationPatterns = [
        /^what information do you have\??$/,
        /^what documents do you have\??$/,
        /^what is available in your knowledge base\??$/,
        /^which documents are available\??$/
    ];

    const isInformationQuestion =
        informationPatterns.some(pattern =>
            pattern.test(text)
        );

    if (isInformationQuestion) {
        const availableSources =
            getAvailableSources(tenantId);

        if (availableSources.length === 0) {
            return "There are currently no indexed documents available for your account.";
        }

        const sourceList = availableSources
            .slice(0, 15)
            .map(source => `- ${source}`)
            .join("\n");

        const remaining =
            availableSources.length > 15
                ? `\n\nAnd ${availableSources.length - 15} more sources.`
                : "";

        return `I can search the following indexed sources:

${sourceList}${remaining}

You can ask me to search, summarize, or extract information from these sources.

Note: This is a list of available source names, not a complete summary of their contents.`;
    }

    return null;
}

// ==========================================
// SYSTEM PROMPT
// ==========================================

const SYSTEM_PROMPT = `
You are a strict document-grounded AI assistant.

Your ONLY source of factual information is the DOCUMENT CONTEXT
provided below.

STRICT SOURCE RULES:

1. Answer ONLY using facts explicitly supported by the supplied
   document context.

2. NEVER use pretrained knowledge, general knowledge, assumptions,
   outside information or information remembered from previous answers.

3. A sitemap URL only identifies a page. It does not prove what
   the page contains. Use extracted document content as evidence.

4. Never invent facts, numbers, dates, names, specifications,
   product details, contracts, URLs or procedures.

5. If the context does not contain the answer, respond exactly:

"I couldn't find that information in the available documents."

6. If the context supports only part of the question:
   - Clearly explain the supported information.
   - Clearly identify what is missing.
   - Do not fill missing information using general knowledge.

7. If multiple documents describe different projects, contracts,
   products or business units, keep those details separate.
   Do not combine unrelated projects.

8. If documents contain historical information, identify the
   relevant date or period when it is explicitly available.
   Never present historical information as current.

9. Do not assume that an older document describes the latest
   status of a product, project or contract.

10. If documents disagree, explain the disagreement instead of
    choosing an unsupported answer.

11. Previous assistant messages are not factual evidence.
    Only the supplied document context is evidence.

12. Never generate fake references or URLs.

13. If a document only mentions a product or technical term
    without explaining it, do not invent a general definition.

14. Do not use outside knowledge to explain technical terms.

RESPONSE FORMATTING:

- Use Markdown.
- Use short headings when useful.
- Use bullet points for multiple items.
- Use numbered lists where appropriate.
- Use bold for important terms.
- Keep answers clear and concise.
- Mention dates when supported by the documents.
- Do not add general explanations unless the documents support them.

DOCUMENT CONTEXT:

{context}
`;

// ==========================================
// ASK RAG
// Supports normal and streaming responses.
// ==========================================

async function askRAG(
    question,
    source = "all",
    messages = [],
    tenantId,
    onToken = null
) {
    tenantId = validateTenantId(tenantId);

    if (
        typeof question !== "string" ||
        !question.trim()
    ) {
        throw new Error("A valid question is required.");
    }

    const trimmedQuestion = question.trim();

    console.log("\n========== RAG REQUEST ==========");
    console.log("Tenant:", tenantId);
    console.log("Original question:", trimmedQuestion);

    // ======================================
    // STEP 1: HANDLE CAPABILITY QUESTIONS
    // ======================================

    const capabilityResponse =
        getCapabilityResponse(trimmedQuestion, tenantId);

    if (capabilityResponse) {
        console.log("General capability question detected.");

        if (typeof onToken === "function") {
            onToken(capabilityResponse);
        }

        return {
            answer: capabilityResponse,
            sources: []
        };
    }

    // ======================================
    // STEP 2: UNDERSTAND FOLLOW-UP QUESTION
    // ======================================

    const standaloneQuestion =
        await contextualizeQuestion(
            trimmedQuestion,
            messages
        );

    console.log("Question used for retrieval:", standaloneQuestion);

    // ======================================
    // STEP 3: CREATE QUESTION EMBEDDING
    // ======================================

    const queryEmbedding =
        await createEmbedding(standaloneQuestion);

    // ======================================
    // STEP 4: TENANT-AWARE DOCUMENT SEARCH
    // ======================================

    const searchResults = searchSimilar(
        queryEmbedding,
        TOP_K,
        source,
        standaloneQuestion,
        tenantId
    );

    // ======================================
    // STEP 5: RETRIEVAL DEBUG LOGS
    // ======================================

    console.log("\n========== RETRIEVAL DEBUG ==========");

    console.log("Original question:", trimmedQuestion);
    console.log("Search question:", standaloneQuestion);

    console.table(
        searchResults.map(result => ({
            title: result.title || "Untitled",
            score: Number(result.score || 0).toFixed(3),
            semantic: Number(result.semanticScore || 0).toFixed(3),
            lexical: Number(result.lexicalScore || 0).toFixed(3),
            url: result.url || "No URL"
        }))
    );

    // ======================================
    // STEP 6: RELEVANCE FILTER
    // ======================================

    const relevantResults = searchResults.filter(result => {
        if (
            typeof result.score !== "number" ||
            !Number.isFinite(result.score)
        ) {
            return false;
        }
    
        // Use a separate threshold for uploaded PDFs
        const minimumScore =
            result.sourceType === "pdf"
                ? PDF_MIN_RELEVANCE_SCORE
                : MIN_RELEVANCE_SCORE;
    
        return result.score >= minimumScore;
    });

    console.log(
        "Relevant documents:",
        relevantResults.length
    );

    // ======================================
    // STEP 7: HANDLE NO RELEVANT DOCUMENTS
    // ======================================

    if (relevantResults.length === 0) {
        console.log("No relevant documents found.");

        if (typeof onToken === "function") {
            onToken(REFUSAL_MESSAGE);
        }

        return {
            answer: REFUSAL_MESSAGE,
            sources: []
        };
    }

    // ======================================
    // STEP 8: GET NEIGHBORING CHUNKS
    // ======================================

    const contextResults = getNeighboringChunks(
        relevantResults,
        tenantId
    );

    if (contextResults.length === 0) {
        console.log("No context chunks found.");

        if (typeof onToken === "function") {
            onToken(REFUSAL_MESSAGE);
        }

        return {
            answer: REFUSAL_MESSAGE,
            sources: []
        };
    }

    // ======================================
    // STEP 9: BUILD DOCUMENT CONTEXT
    // ======================================

    const context = buildContext(contextResults);

    const systemPrompt = SYSTEM_PROMPT.replace(
        "{context}",
        context
    );

    // ======================================
    // STEP 10: BUILD GENERATION MESSAGES
    // ======================================

    // Previous conversation messages are deliberately
    // NOT sent to the answer-generation model.
    //
    // Only the standalone question and retrieved
    // document context are used for generating answers.

    const chatMessages = [
        {
            role: "system",
            content: systemPrompt
        },
        {
            role: "user",
            content: standaloneQuestion
        }
    ];

    // ======================================
    // STEP 11: OLLAMA GENERATION
    // ======================================

    const shouldStream =
        typeof onToken === "function";

    console.log("\n========== OLLAMA GENERATION ==========");
    console.log("Streaming:", shouldStream);

    const response = await ollama.chat({
        model: MODEL,
        messages: chatMessages,
        stream: shouldStream,

        options: {
            temperature: 0,
            num_predict: 512
        },

        keep_alive: "10m"
    });

    let answer = "";

    // ======================================
    // STEP 12: STREAM OR NORMAL RESPONSE
    // ======================================

    if (shouldStream) {
        for await (const chunk of response) {
            const token =
                chunk.message?.content || "";

            if (!token) continue;

            answer += token;

            onToken(token);
        }

    } else {
        answer = response.message?.content || "";
    }

    answer = answer.trim();

    // ======================================
    // STEP 13: HANDLE EMPTY ANSWER
    // ======================================

    if (!answer) {
        answer = REFUSAL_MESSAGE;
    }

    // ======================================
    // STEP 14: RETURN ANSWER + REFERENCES
    // ======================================

    const sources = buildSources(relevantResults);

    console.log("\n========== RAG COMPLETED ==========");
    console.log("Answer length:", answer.length);
    console.log("Sources:", sources.length);

    return {
        answer,
        sources
    };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    askRAG,
    getAvailableSources
};
