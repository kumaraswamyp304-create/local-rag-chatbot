const { askRAG } = require("./rag");

async function main() {
    const messages = [];

    // First question
    const question1 = "What is Python?";

    const result1 = await askRAG(
        question1,
        "all",
        messages
    );

    console.log("\nUSER:", question1);
    console.log("BOT:", result1.answer);

    messages.push(
        { role: "user", content: question1 },
        { role: "assistant", content: result1.answer }
    );

    // Follow-up question
    const question2 = "What are its main features?";

    const result2 = await askRAG(
        question2,
        "all",
        messages
    );

    console.log("\nUSER:", question2);
    console.log("BOT:", result2.answer);

    console.log("\nREWRITTEN QUESTION:");
    console.log(result2.retrievalQuery);

    console.log("\nSOURCES:");
    console.log(result2.sources);
}

main().catch(error => {
    console.error("CONVERSATION TEST FAILED:", error);
});
