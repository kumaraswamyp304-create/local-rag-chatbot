
const { extractWebPage } = require("./extractors/webExtractor");

async function main() {
    console.log("Starting website extraction...\n");

    const result = await extractWebPage(
      "https://docs.python.org/3/tutorial/index.html"
  );

    console.log("========== EXTRACTION RESULT ==========");
    console.log("Title:", result.title);
    console.log("URL:", result.url);
    console.log("Description:", result.description);
    console.log("Extracted characters:", result.text.length);
    console.log("\nPreview:\n", result.text.substring(0, 1000));
}

main().catch(error => {
    console.error("TEST FAILED:", error.message);
});
