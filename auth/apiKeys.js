
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEY_FILE = path.join(__dirname, "api-keys.json");

function loadKeys() {
    if (!fs.existsSync(KEY_FILE)) {
        return [];
    }

    return JSON.parse(
        fs.readFileSync(KEY_FILE, "utf8")
    );
}

function saveKeys(keys) {
    fs.writeFileSync(
        KEY_FILE,
        JSON.stringify(keys, null, 2),
        { mode: 0o600 }
    );
}

function hashKey(apiKey) {
    return crypto
        .createHash("sha256")
        .update(apiKey)
        .digest("hex");
}

function createApiKey(tenantId) {
    if (
        typeof tenantId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)
    ) {
        throw new Error("Invalid tenant ID.");
    }

    const keys = loadKeys();

    const apiKey = `rag_${crypto.randomBytes(32).toString("hex")}`;

    keys.push({
        tenantId,
        keyHash: hashKey(apiKey),
        createdAt: new Date().toISOString(),
        active: true
    });

    saveKeys(keys);

    return {
        tenantId,
        apiKey
    };
}

function validateApiKey(apiKey) {
    if (
        typeof apiKey !== "string" ||
        !/^rag_[a-f0-9]{64}$/.test(apiKey)
    ) {
        return null;
    }

    const candidateHash = Buffer.from(
        hashKey(apiKey),
        "hex"
    );

    const keys = loadKeys();

    for (const entry of keys) {
        if (!entry.active) {
            continue;
        }

        const storedHash = Buffer.from(
            entry.keyHash,
            "hex"
        );

        if (
            storedHash.length === candidateHash.length &&
            crypto.timingSafeEqual(storedHash, candidateHash)
        ) {
            return entry.tenantId;
        }
    }

    return null;
}

module.exports = {
    createApiKey,
    validateApiKey
};
