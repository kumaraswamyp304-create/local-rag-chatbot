
const crypto = require("crypto");

const { getSitemapURLs } = require("./sitemap");
const { extractWebPage } = require("./extractors/webExtractor");
const { createEmbedding } = require("./embeddings");
const { addDocuments } = require("./store");
const { splitText } = require("./ingest");

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_LIMIT = 50;

// Default machinery-related URL keywords.
// These are matched against URL paths, not page content.
const DEFAULT_INCLUDE_KEYWORDS = [
    "machinery",
    "machine",
    "equipment",
    "construction",
    "mining",
    "heavy-engineering",
    "heavy-engineering",
    "manufacturing",
    "industrial",
    "hydraulic",
    "excavator",
    "crane",
    "defence",
    "defense",
    "engineering"
];

function createDocumentId(url, tenantId = "default") {
    return crypto
        .createHash("sha256")
        .update(`${tenantId}:${url}`)
        .digest("hex");
}

function filterWebsiteURLs(urls, options = {}) {
    const includeKeywords = options.includeKeywords || [];
    const excludeKeywords = options.excludeKeywords || [];

    // No inclusion keywords means no inclusion filtering.
    return urls.filter(url => {
        let pathname;

        try {
            pathname = new URL(url).pathname.toLowerCase();
        } catch {
            return false;
        }

        // Exclude unwanted URL paths first.
        if (
            excludeKeywords.some(keyword =>
                pathname.includes(keyword.toLowerCase())
            )
        ) {
            return false;
        }

        // Include only matching URL paths when keywords are supplied.
        if (includeKeywords.length > 0) {
            return includeKeywords.some(keyword =>
                pathname.includes(keyword.toLowerCase())
            );
        }

        return true;
    });
}

async function ingestWebsite(sitemapUrl, options = {}) {
    const tenantId = options.tenantId || "default";

    if (typeof tenantId !== "string" || !tenantId.trim()) {
        throw new Error("A valid tenantId is required.");
    }

    let parsedSitemapURL;

    try {
        parsedSitemapURL = new URL(sitemapUrl);

        if (!["http:", "https:"].includes(parsedSitemapURL.protocol)) {
            throw new Error("Only HTTP and HTTPS sitemap URLs are allowed");
        }
    } catch {
        throw new Error("A valid sitemap URL is required.");
    }

    const maxPages = Math.min(
        Math.max(
            Number(options.maxPages) || DEFAULT_MAX_PAGES,
            1
        ),
        MAX_PAGES_LIMIT
    );

    const includeKeywords = Array.isArray(options.includeKeywords)
        ? options.includeKeywords
        : [];

    const excludeKeywords = Array.isArray(options.excludeKeywords)
        ? options.excludeKeywords
        : [];

    console.log("\n========== WEBSITE INGESTION ==========");
    console.log("Tenant:", tenantId);
    console.log("Sitemap:", sitemapUrl);
    console.log("Maximum pages:", maxPages);
    console.log("Include keywords:", includeKeywords);
    console.log("Exclude keywords:", excludeKeywords);

    // Step 1: Read sitemap.
    const sitemapResult = await getSitemapURLs(sitemapUrl);

    console.log("Discovered sitemap URLs:", sitemapResult.totalURLs);

    // Step 2: Filter URLs.
    const filteredURLs = filterWebsiteURLs(
        sitemapResult.urls,
        {
            includeKeywords,
            excludeKeywords
        }
    );

    console.log("URLs after filtering:", filteredURLs.length);

    if (filteredURLs.length === 0) {
        throw new Error(
            "No matching website URLs found. Check your includeKeywords and sitemap."
        );
    }

    // Step 3: Apply page limit after filtering.
    const urls = filteredURLs.slice(0, maxPages);

    console.log("URLs selected for ingestion:", urls.length);

    const websiteSource = `website:${parsedSitemapURL.hostname}`;

    const documents = [];
    const errors = [];
    const successfulURLs = [];

    // Step 4: Extract and process pages.
    for (let pageIndex = 0; pageIndex < urls.length; pageIndex++) {
        const url = urls[pageIndex];

        try {
            console.log(
                `\nProcessing page ${pageIndex + 1}/${urls.length}: ${url}`
            );

            const page = await extractWebPage(url);

            if (!page || !page.text || !page.text.trim()) {
                throw new Error("No readable page content extracted");
            }

            const documentId = createDocumentId(url, tenantId);

            const chunks = splitText(page.text);

            console.log("Title:", page.title);
            console.log("Document ID:", documentId);
            console.log("Chunks:", chunks.length);

            if (!chunks || chunks.length === 0) {
                throw new Error("No text chunks generated");
            }

            // Step 5: Generate embeddings.
            for (
                let chunkIndex = 0;
                chunkIndex < chunks.length;
                chunkIndex++
            ) {
                const chunk = chunks[chunkIndex];

                if (!chunk || !chunk.trim()) {
                    continue;
                }

                console.log(
                    `Generating embedding ${chunkIndex + 1}/${chunks.length}`
                );

                const embedding = await createEmbedding(chunk);

                documents.push({
                    id: `${tenantId}-${documentId}-${chunkIndex}`,
                    tenantId,
                    documentId,

                    source: websiteSource,
                    sourceType: "website",

                    url,
                    canonicalUrl: page.url,

                    title: page.title,
                    description: page.description,

                    chunkIndex,
                    pageIndex,

                    text: chunk,
                    embedding,

                    metadata: {
                        tenantId,
                        websiteSource,
                        documentId,
                        url,
                        canonicalUrl: page.url,
                        title: page.title,
                        extractedAt: page.metadata?.extractedAt || new Date().toISOString()
                    }
                });
            }

            successfulURLs.push(url);

            console.log("Page indexed successfully");

        } catch (error) {
            console.error(
                "Page ingestion failed:",
                error.message
            );

            errors.push({
                url,
                error: error.message
            });
        }
    }

    // Step 6: Save documents to the existing vector store.
    if (documents.length > 0) {
        console.log("\nSaving documents to vector store...");

        addDocuments(documents);

        console.log("Documents saved successfully");
    }

    // Step 7: Return ingestion summary.
    const result = {
        tenantId,
        websiteSource,

        discoveredURLs: sitemapResult.totalURLs,
        filteredURLs: filteredURLs.length,
        attemptedPages: urls.length,

        successfulPages: successfulURLs.length,
        failedPages: errors.length,

        totalChunks: documents.length,

        uniqueDocuments: new Set(
            documents.map(doc => doc.documentId)
        ).size,

        successfulURLs,
        errors
    };

    console.log("\n========== INGESTION SUMMARY ==========");
    console.log(JSON.stringify(result, null, 2));

    return result;
}

module.exports = {
    ingestWebsite,
    createDocumentId,
    filterWebsiteURLs
};
