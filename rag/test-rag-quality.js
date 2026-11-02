
const { askRAG } = require("./rag");

const testCases = [
    {
        id: 1,
        category: "EXACT_FACT",
        question: "What is Python's name derived from?",
        expectedKeywords: [
            "monty python",
            "flying circus"
        ],
        shouldFindAnswer: true
    },
    {
        id: 2,
        category: "PARAPHRASED",
        question: "Why was the Python programming language given that name?",
        expectedKeywords: [
            "monty python",
            "flying circus"
        ],
        shouldFindAnswer: true
    },
    {
        id: 3,
        category: "DOCUMENT_FEATURES",
        question: "What makes Python useful for application development?",
        expectedKeywords: [
            "easy to learn",
            "high-level",
            "scripting"
        ],
        shouldFindAnswer: true
    },
    {
        id: 4,
        category: "OUT_OF_DOCUMENT",
        question: "What is the CEO's personal mobile number?",
        expectedKeywords: [],
        shouldFindAnswer: false
    },
    {
        id: 5,
        category: "UNRELATED",
        question: "Who won the FIFA World Cup in 2022?",
        expectedKeywords: [],
        shouldFindAnswer: false
    }
];

function checkKeywords(answer, keywords) {
    const normalizedAnswer = answer.toLowerCase();

    return keywords.filter(keyword =>
        normalizedAnswer.includes(keyword.toLowerCase())
    );
}

async function runEvaluation() {
    let passed = 0;
    let failed = 0;

    console.log("\n========== RAG QUALITY EVALUATION ==========\n");

    for (const test of testCases) {
        console.log(`\nTEST ${test.id}: ${test.category}`);
        console.log("QUESTION:", test.question);

        try {
            const result = await askRAG(
                test.question,
                "all",
                []
            );

            const answer = result.answer || "";
            const hasSources = result.sources.length > 0;
            const matchedKeywords = checkKeywords(
                answer,
                test.expectedKeywords
            );

            const answerCheck = test.shouldFindAnswer
                ? hasSources && matchedKeywords.length > 0
                : !hasSources;

            const keywordCheck = test.shouldFindAnswer
                ? matchedKeywords.length > 0
                : true;

            const testPassed = answerCheck && keywordCheck;

            if (testPassed) {
                passed++;
            } else {
                failed++;
            }

            console.log("\nANSWER:");
            console.log(answer);

            console.log("\nSOURCES FOUND:", result.sources.length);
            console.log("MATCHED KEYWORDS:", matchedKeywords);

            console.log(
                "\nRESULT:",
                testPassed ? "PASS" : "FAIL"
            );

        } catch (error) {
            failed++;
            console.error("\nERROR:", error.message);
            console.log("\nRESULT: FAIL");
        }

        console.log("\n------------------------------------");
    }

    const total = testCases.length;
    const accuracy = ((passed / total) * 100).toFixed(2);

    console.log("\n========== FINAL REPORT ==========");
    console.log("Total tests:", total);
    console.log("Passed:", passed);
    console.log("Failed:", failed);
    console.log("Evaluation score:", `${accuracy}%`);
    console.log("==================================");
}

runEvaluation().catch(console.error);
