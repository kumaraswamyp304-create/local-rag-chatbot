const path = require("path");

const {
    ingestPDF
} = require("./ingest");


async function main() {

    const fileName = "Tutorial.pdf";

    const filePath = path.join(
        __dirname,
        "..",
        "uploads",
        fileName
    );

    try {

        const result =
            await ingestPDF(
                filePath,
                fileName
            );

        console.log(
            "\n========== RESULT =========="
        );

        console.log(result);

        console.log(
            "============================"
        );

    } catch (error) {

        console.error(
            "\nINGEST ERROR:"
        );

        console.error(error);

    }
}

main();