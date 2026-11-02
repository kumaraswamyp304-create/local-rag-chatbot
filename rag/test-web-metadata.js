
const { getDocuments } = require("./store");

function main() {
    const documents = getDocuments();

    const websiteDocuments = documents.filter(
        doc => doc.sourceType === "website"
    );

    console.log("\n========== WEBSITE METADATA CHECK ==========");

    console.log("Total website chunks:", websiteDocuments.length);

    const uniqueDocumentIds = [
        ...new Set(
            websiteDocuments.map(doc => doc.documentId)
        )
    ];

    console.log("Unique documents:", uniqueDocumentIds.length);

    console.log("\nDocument details:");

    for (const documentId of uniqueDocumentIds) {
        const chunks = websiteDocuments.filter(
            doc => doc.documentId === documentId
        );

        console.log("\nTitle:", chunks[0].title);
        console.log("URL:", chunks[0].url);
        console.log("Document ID:", documentId);
        console.log("Chunk count:", chunks.length);

        console.log(
            "Chunk indexes:",
            chunks.map(doc => doc.chunkIndex)
        );
    }
}

main();
