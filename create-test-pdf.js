const fs = require("fs");
const PDFDocument = require("pdfkit");

const output = fs.createWriteStream("uploads/unique-test.pdf");

const doc = new PDFDocument({
    autoFirstPage: true,
    compress: false,
    pdfVersion: "1.4"
});

output.on("finish", () => {
    console.log("Test PDF created successfully.");
});

output.on("error", error => {
    console.error("PDF creation failed:", error);
});

doc.pipe(output);

doc.font("Helvetica")
   .fontSize(18)
   .text("Test Client Private Document");

doc.moveDown();

doc.fontSize(12)
   .text("The secret project code for Test Client is ORANGE-7291.");

doc.end();
