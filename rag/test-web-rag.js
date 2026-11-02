
const { askRAG } = require("./rag");
const { getDocuments } = require("./store");

async function main() {
    console.log("\n========== VECTOR STORE CHECK ==========");

    const documents = getDocuments();

    const sources = [...new Set(
        documents.map(doc => doc.source)
    )];

    console.log("Total chunks:", documents.length);
    console.log("Available sources:", sources);

    console.log("\n========== WEBSITE RAG TEST ==========");

    const question =
        "Which Python documentation versions are available in the indexed content?";

    console.log("Question:", question);

    const result = await askRAG(question, "all", []);

    console.log("\nAnswer:", result.answer);
    console.log("\nRetrieved sources:", result.sources);
}

main().catch(error => {
    console.error("RAG TEST FAILED:", error);
});
