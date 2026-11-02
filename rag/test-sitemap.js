
const { getSitemapURLs } = require("./sitemap");

async function main() {
  const sitemapUrl =
  "https://docs.python.org/sitemap.xml";

    console.log("\nStarting sitemap extraction...\n");

    const result = await getSitemapURLs(sitemapUrl);

    console.log("\n========== SITEMAP RESULT ==========");
    console.log("Sitemaps found:", result.sitemapCount);
    console.log("Total URLs:", result.totalURLs);

    console.log("\nFirst 20 URLs:");

    result.urls.slice(0, 20).forEach((url, index) => {
        console.log(`${index + 1}. ${url}`);
    });
}

main().catch(error => {
    console.error("SITEMAP TEST FAILED:", error.message);
});
