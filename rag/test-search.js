
const { createEmbedding } = require("./embeddings");
const { searchSimilar } = require("./search");

async function main() {
    const question =
        "What is Python and what are its main features?";

    console.log("Question:", question);

    const embedding = await createEmbedding(question);

    const results = searchSimilar(
        embedding,
        3,
        "all",
        question
    );

    console.log("\n========== SEARCH RESULTS ==========\n");

    if (results.length === 0) {
        console.log("No matching documents found.");
        return;
    }

    results.forEach((result, index) => {
        console.log(`Result ${index + 1}`);
        console.log("Score:", result.score);
        console.log("Semantic Score:", result.semanticScore);
        console.log("Keyword Boost:", result.keywordBoost);
        console.log("Source:", result.source);
        console.log("Title:", result.title || "N/A");
        console.log("URL:", result.url || "N/A");
        console.log("Chunk:", result.chunkIndex);
        console.log("Text:", result.text);
        console.log("\n-----------------------------------\n");
    });
}

main().catch(error => {
    console.error("SEARCH ERROR:", error);
});
