
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");

const { createEmbedding } = require("./embeddings");
const { addDocuments } = require("./store");

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Split text into overlapping chunks
function splitText(text) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(
            start + CHUNK_SIZE,
            text.length
        );

        const chunk = text.slice(start, end).trim();

        if (chunk) {
            chunks.push(chunk);
        }

        if (end >= text.length) {
            break;
        }

        start = end - CHUNK_OVERLAP;
    }

    return chunks;
}

// Generate tenant-specific document ID
function createDocumentId(filePath, tenantId = "default") {
    return crypto
        .createHash("sha256")
        .update(`${tenantId}:${path.resolve(filePath)}`)
        .digest("hex");
}

// Ingest PDF
async function ingestPDF(filePath, fileName, tenantId = "default") {
    if (!tenantId || typeof tenantId !== "string") {
        throw new Error("A valid tenantId is required.");
    }

    console.log(`Reading PDF: ${fileName}`);
    console.log(`Tenant: ${tenantId}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`PDF file not found: ${filePath}`);
    }

    const pdfBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text || "";

    console.log(`Extracted ${text.length} characters`);

    if (!text.trim()) {
        throw new Error("No readable text found in PDF");
    }

    const chunks = splitText(text);

    console.log(`Created ${chunks.length} chunks`);

    const documentId = createDocumentId(filePath, tenantId);
    const documents = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        console.log(`Embedding ${i + 1}/${chunks.length}`);

        const embedding = await createEmbedding(chunk);

        documents.push({
            id: `${tenantId}-${documentId}-${i}`,
            tenantId,
            documentId,

            source: fileName,
            sourceType: "pdf",

            title: fileName,
            fileName,

            chunkIndex: i,
            pageIndex: null,

            text: chunk,
            embedding,

            metadata: {
                tenantId,
                documentId,
                sourceType: "pdf",
                fileName,
                title: fileName,
                totalPages: pdfData.numpages,
                chunkIndex: i
            }
        });
    }

    addDocuments(documents);

    console.log(`Stored ${documents.length} chunks for tenant ${tenantId}`);

    return {
        tenantId,
        fileName,
        documentId,
        pages: pdfData.numpages,
        chunks: documents.length
    };
}

module.exports = {
    ingestPDF,
    splitText,
    createDocumentId
};
