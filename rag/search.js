
const { getDocuments } = require("./store");

// Calculate cosine similarity between two embedding vectors.
function cosineSimilarity(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length !== b.length ||
        a.length === 0
    ) {
        return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct / (
        Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)
    );
}

function normalizeText(text = "") {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were",
    "to", "of", "in", "on", "at", "for", "from",
    "and", "or", "but", "with", "by", "as", "it",
    "this", "that", "these", "those", "i", "we",
    "you", "he", "she", "they", "what", "which",
    "who", "when", "where", "how", "can", "could",
    "would", "should", "do", "does", "did",
    "please", "tell", "me", "about",
    "was", "were", "has", "have", "had",
    "received", "mentioned", "listed", "show",
    "find", "give", "explain"
]);

function expandQuery(query = "") {
    return normalizeText(query)
        .split(" ")
        .filter(word =>
            word &&
            !STOP_WORDS.has(word) &&
            word.length > 1
        );
}

// Improved lexical matching.
// Considers exact phrases, individual terms and partial word matches.
function lexicalScore(query, documentText) {
    const queryWords = expandQuery(query);

    if (queryWords.length === 0) {
        return 0;
    }

    const normalizedQuery = normalizeText(query);
    const normalizedDocument = normalizeText(documentText);

    if (!normalizedDocument) {
        return 0;
    }

    const documentWords = new Set(
        normalizedDocument.split(" ")
    );

    let matchedWords = 0;

    for (const word of queryWords) {
        if (documentWords.has(word)) {
            matchedWords++;
        }
    }

    const wordMatchScore =
        matchedWords / queryWords.length;

    const phraseMatchScore =
        normalizedQuery.length > 0 &&
        normalizedDocument.includes(normalizedQuery)
            ? 1
            : 0;

    // Small partial-match contribution for related word forms.
    let partialMatches = 0;

    for (const word of queryWords) {
        if (
            !documentWords.has(word) &&
            word.length >= 5 &&
            [...documentWords].some(docWord =>
                docWord.length >= 5 &&
                (
                    docWord.startsWith(word) ||
                    word.startsWith(docWord)
                )
            )
        ) {
            partialMatches++;
        }
    }

    const partialMatchScore =
        partialMatches / queryWords.length;

    return Math.min(
        1,
        wordMatchScore * 0.65 +
        phraseMatchScore * 0.25 +
        partialMatchScore * 0.10
    );
}

// Search only documents belonging to the requested tenant.
function searchSimilar(
    queryEmbedding,
    topK = 6,
    source = "all",
    query = "",
    tenantId
) {
    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
        throw new Error("A valid tenantId is required for search.");
    }

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        throw new Error("A valid query embedding is required.");
    }

    const safeTopK = Math.max(
        1,
        Math.min(Number(topK) || 6, 50)
    );

    let documents = getDocuments(tenantId);

    // Enforce tenant isolation even if the store returns unexpected data.
    documents = documents.filter(
        doc => doc.tenantId === tenantId
    );

    if (source && source !== "all") {
        documents = documents.filter(
            doc => doc.source === source
        );
    }

    const results = documents
        .filter(doc =>
            Array.isArray(doc.embedding) &&
            doc.embedding.length === queryEmbedding.length
        )
        .map(doc => {
            const semanticScore = Math.max(
                0,
                cosineSimilarity(queryEmbedding, doc.embedding)
            );

            const lexical = lexicalScore(
                query,
                doc.text || ""
            );

            const score =
                semanticScore * 0.80 +
                lexical * 0.20;

            return {
                ...doc,
                score,
                semanticScore,
                lexicalScore: lexical
            };
        });

    return results
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }

            return b.lexicalScore - a.lexicalScore;
        })
        .slice(0, safeTopK);
}

module.exports = {
    cosineSimilarity,
    normalizeText,
    expandQuery,
    lexicalScore,
    searchSimilar
};
