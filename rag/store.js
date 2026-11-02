
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "vector-store.json");

function loadDocuments() {
    if (!fs.existsSync(STORE_PATH)) {
        fs.writeFileSync(STORE_PATH, "[]", "utf8");
    }

    const documents = JSON.parse(
        fs.readFileSync(STORE_PATH, "utf8")
    );

    if (!Array.isArray(documents)) {
        throw new Error("Vector store must contain an array.");
    }

    return documents;
}

function saveDocuments(documents) {
    fs.writeFileSync(
        STORE_PATH,
        JSON.stringify(documents, null, 2),
        "utf8"
    );
}

function addDocuments(newDocuments) {
    if (!Array.isArray(newDocuments)) {
        throw new Error("Documents must be an array.");
    }

    if (newDocuments.length === 0) {
        return;
    }

    // Validate every document before changing the store.
    for (const doc of newDocuments) {
        if (!doc.tenantId || typeof doc.tenantId !== "string") {
            throw new Error("Every document must have a tenantId.");
        }

        if (!doc.source || typeof doc.source !== "string") {
            throw new Error("Every document must have a source.");
        }
    }

    const existingDocuments = loadDocuments();

    // Replace documents only when BOTH tenantId and source match.
    const replacementKeys = new Set(
        newDocuments.map(
            doc => JSON.stringify([doc.tenantId, doc.source])
        )
    );

    const remainingDocuments = existingDocuments.filter(doc => {
        const key = JSON.stringify([doc.tenantId, doc.source]);
        return !replacementKeys.has(key);
    });

    const updatedDocuments = [
        ...remainingDocuments,
        ...newDocuments
    ];

    saveDocuments(updatedDocuments);

    console.log(
        `Added ${newDocuments.length} documents.`
    );
}

function getDocuments(tenantId) {
    if (!tenantId || typeof tenantId !== "string") {
        throw new Error("A valid tenantId is required.");
    }

    const documents = loadDocuments();

    return documents.filter(
        doc => doc.tenantId === tenantId
    );
}

module.exports = {
    addDocuments,
    getDocuments
};
