const { ingestWebsite } = require("./rag/ingestWeb");

async function main() {
    try {
        console.log("Starting L&T website ingestion test...");

        const result = await ingestWebsite(
            "https://www.larsentoubro.com/sitemap.xml",
            {
                tenantId: "default",
                maxPages: 5,

                includeKeywords: [
                    "machinery",
                    "equipment",
                    "construction",
                    "mining",
                    "heavy-engineering",
                    "manufacturing",
                    "industrial",
                    "hydraulic",
                    "excavator",
                    "crane"
                ],

                excludeKeywords: [
                    "leadership",
                    "investor",
                    "awards-recognition"
                ]
            }
        );

        console.log("\nL&T TEST COMPLETED");
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error("L&T TEST FAILED:", error);
    }
}

main();
