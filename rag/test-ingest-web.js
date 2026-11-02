
const { ingestWebsite } = require("./ingestWeb");

async function main() {
    try {
        console.log("Starting website indexing...\n");

        const result = await ingestWebsite(
            "https://docs.python.org/sitemap.xml",
            {
                maxPages: 5
            }
        );

        console.log("\n========== FINAL RESULT ==========");
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error("WEBSITE INGESTION FAILED:", error);
    }
}

main();
