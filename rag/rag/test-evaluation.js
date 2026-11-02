cat > rag/test-evaluation.js <<'EOF'
const { askRAG } = require("./rag");

const testCases = [
    {
        category: "IN-DOCUMENT",
        question: "What is Python's name derived from?"
    },
    {
        category: "IN-DOCUMENT",
        question: "What are the main features of Python?"
    },
    {
        category: "OUT-OF-DOCUMENT",
        question: "What is the CEO's personal mobile number?"
    },
    {
        category: "UNRELATED",
        question: "Who won the FIFA World Cup in 2022?"
    }
];

async function runEvaluation() {
    console.log("\n========== RAG EVALUATION ==========\n");

    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];

        console.log(`\nTEST ${i + 1}: ${test.category}`);
        console.log("QUESTION:", test.question);

        try {
            const result = await askRAG(
                test.question,
                "all",
                []
            );

            console.log("\nANSWER:");
            console.log(result.answer);

            console.log("\nRETRIEVED SOURCES:");
            console.log(result.sources.length);

            console.log(
                result.sources.map(source => ({
                    document: source.title,
                    chunk: source.chunk,
                    neighbor: source.retrievedAsNeighbor
                }))
            );

        } catch (error) {
            console.error("TEST FAILED:", error.message);
        }

        console.log("\n------------------------------------");
    }

    console.log("\n========== EVALUATION COMPLETED ==========");
}

runEvaluation().catch(console.error);
EOF