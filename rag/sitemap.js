
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "url" || name === "sitemap"
});

const MAX_SITEMAPS = 100;
const MAX_URLS = 10000;
const REQUEST_TIMEOUT = 20000;

async function fetchXML(url) {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Only HTTP and HTTPS sitemap URLs are allowed");
    }

    const response = await fetch(url, {
        headers: {
            "User-Agent": "LocalRAGBot/1.0",
            "Accept": "application/xml, text/xml, */*"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    });

    if (!response.ok) {
        throw new Error(
            `Sitemap request failed: HTTP ${response.status}`
        );
    }

    const contentType =
        response.headers.get("content-type") || "";

    if (
        contentType &&
        !contentType.includes("xml") &&
        !contentType.includes("text/plain")
    ) {
        throw new Error("URL did not return XML content");
    }

    return response.text();
}

// Convert Markdown-formatted sitemap locations into normal URLs.
function cleanSitemapURL(value) {
    if (typeof value !== "string") {
        return null;
    }

    value = value.trim();

    // Handle: [https://example.com](https://example.com)
    const markdownMatch = value.match(
        /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/
    );

    if (markdownMatch) {
        value = markdownMatch[2];
    }

    // Handle escaped brackets or parentheses.
    value = value.replace(/\\/g, "");

    // Handle remaining simple Markdown wrappers.
    if (value.startsWith("[") && value.includes("](")) {
        value = value.split("](", 1)[1].split(")", 1)[0];
    }

    return normalizeURL(value);
}

function normalizeURL(url) {
    try {
        const parsed = new URL(url);

        if (!["http:", "https:"].includes(parsed.protocol)) {
            return null;
        }

        parsed.hash = "";

        return parsed.href;
    } catch {
        return null;
    }
}

async function readSitemap(sitemapUrl, state = null) {
    const currentState = state || {
        visitedSitemaps: new Set(),
        discoveredUrls: new Set()
    };

    const normalizedSitemap = cleanSitemapURL(sitemapUrl);

    if (!normalizedSitemap) {
        throw new Error("Invalid sitemap URL");
    }

    if (currentState.visitedSitemaps.has(normalizedSitemap)) {
        return currentState;
    }

    if (currentState.visitedSitemaps.size >= MAX_SITEMAPS) {
        console.warn("Maximum sitemap limit reached");
        return currentState;
    }

    currentState.visitedSitemaps.add(normalizedSitemap);

    console.log(`Reading sitemap: ${normalizedSitemap}`);

    const xml = await fetchXML(normalizedSitemap);
    const data = parser.parse(xml);

    // Handle sitemap index files.
    if (data.sitemapindex) {
        const sitemaps = data.sitemapindex.sitemap || [];

        for (const item of sitemaps) {
            if (!item.loc) continue;

            if (currentState.visitedSitemaps.size >= MAX_SITEMAPS) {
                break;
            }

            const nestedSitemapURL = cleanSitemapURL(item.loc);

            if (!nestedSitemapURL) {
                console.warn("Skipping invalid nested sitemap:", item.loc);
                continue;
            }

            await readSitemap(nestedSitemapURL, currentState);
        }

        return currentState;
    }

    // Handle regular URL sitemap files.
    if (data.urlset) {
        const urls = data.urlset.url || [];

        for (const item of urls) {
            if (!item.loc) continue;

            const normalized = cleanSitemapURL(item.loc);

            if (!normalized) {
                console.warn("Skipping invalid sitemap URL:", item.loc);
                continue;
            }

            currentState.discoveredUrls.add(normalized);

            if (currentState.discoveredUrls.size >= MAX_URLS) {
                console.warn("Maximum URL limit reached");
                break;
            }
        }

        return currentState;
    }

    throw new Error("Invalid sitemap XML format");
}

async function getSitemapURLs(sitemapUrl) {
    const state = await readSitemap(sitemapUrl);

    return {
        sitemapCount: state.visitedSitemaps.size,
        totalURLs: state.discoveredUrls.size,
        urls: [...state.discoveredUrls]
    };
}

module.exports = {
    getSitemapURLs,
    cleanSitemapURL,
    normalizeURL
};
