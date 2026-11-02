
const cheerio = require("cheerio");

async function extractWebPage(url) {
    try {
        // Validate URL
        const parsedUrl = new URL(url);

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            throw new Error("Only HTTP and HTTPS URLs are supported");
        }

        console.log(`Extracting webpage: ${url}`);

        // Fetch webpage
        const response = await fetch(url, {
            headers: {
                "User-Agent": "LocalRAGBot/1.0"
            },
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType =
            response.headers.get("content-type") || "";

        if (!contentType.toLowerCase().includes("text/html")) {
            throw new Error("URL did not return HTML content");
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract metadata
        const title =
            $("title").first().text().trim() || "Untitled page";

        const description =
            $('meta[name="description"]').attr("content") ||
            $('meta[property="og:description"]').attr("content") ||
            "";

        const canonicalUrl =
            $('link[rel="canonical"]').attr("href") || url;

        // Remove unwanted elements
        $([
            "script",
            "style",
            "noscript",
            "iframe",
            "svg",
            "canvas",
            "nav",
            "footer",
            "header",
            "aside",
            "form",
            "button",
            "input",
            "select",
            "textarea",
            "[role='navigation']",
            "[aria-hidden='true']",
            ".sphinxsidebar",
            ".related",
            ".breadcrumbs",
            ".headerlink",
            ".theme-switcher",
            ".theme-toggle",
            ".toctree-wrapper",
            ".sidebar",
            ".navigation",
            ".cookie-banner",
            ".advertisement"
        ].join(",")).remove();

        // Find the main content container
        const selectors = [
            "main",
            "[role='main']",
            "article",
            ".document",
            ".body",
            "#content",
            ".content"
        ];

        let contentElement = null;

        for (const selector of selectors) {
            const element = $(selector).first();

            if (element.length && element.text().trim().length > 200) {
                contentElement = element;
                break;
            }
        }

        // Fallback to body when no main container is found
        if (!contentElement) {
            contentElement = $("body");
        }

        // Extract structured content
        const blocks = [];

        contentElement.find(
            "h1, h2, h3, h4, h5, p, li, pre, blockquote"
        ).each((_, element) => {
            const node = $(element);
            const tag = element.tagName.toLowerCase();

            // Avoid duplicate nested text
            if (node.parents("li, pre, blockquote").length) {
                return;
            }

            const content = node.text().trim();

            if (!content) return;

            // Preserve headings
            if (/^h[1-5]$/.test(tag)) {
                const level = Number(tag[1]);
                blocks.push(
                    `${"#".repeat(level)} ${content}`
                );
                return;
            }

            // Preserve code examples
            if (tag === "pre") {
                blocks.push(
                    `\n\`\`\`\n${content}\n\`\`\`\n`
                );
                return;
            }

            // Preserve list items
            if (tag === "li") {
                blocks.push(`- ${content}`);
                return;
            }

            // Preserve blockquotes
            if (tag === "blockquote") {
                blocks.push(`> ${content}`);
                return;
            }

            // Normal paragraphs
            blocks.push(content);
        });

        // Fallback if structured extraction finds nothing
        let text = blocks.length
            ? blocks.join("\n\n")
            : contentElement.text();

        // Normalize whitespace while preserving structure
        text = text
            .replace(/[ \t]+/g, " ")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        if (!text) {
            throw new Error("No readable content found on webpage");
        }

        return {
            title,
            url: canonicalUrl,
            description,
            text,
            metadata: {
                contentType,
                extractedAt: new Date().toISOString()
            }
        };

    } catch (error) {
        console.error(
            `Web extraction failed for ${url}:`,
            error.message
        );

        throw error;
    }
}

module.exports = {
    extractWebPage
};
