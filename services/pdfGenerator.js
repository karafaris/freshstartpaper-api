const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

async function generateJournalPDFs(order) {
  const outputDirectory = path.join(__dirname, "..", "generated");

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  const orderNumber = order.order_number || order.id;
  const lineItem = order.line_items?.[0];

  const properties = {};

  for (const property of lineItem?.properties || []) {
    properties[property.name] = property.value;
  }

  const journalTitle =
    properties["Journal title"] ||
    properties["Journal Title"] ||
    "My Journal";

  const footerQuote =
    properties["Footer quote"] ||
    properties["Footer Quote"] ||
    "";

  const bodyPrompt =
    properties["Body notes prompt"] ||
    properties["Body Notes Prompt"] ||
    "Write about your day.";

  const interiorPath = path.join(
    outputDirectory,
    `order-${orderNumber}-interior.pdf`
  );

  const coverPath = path.join(
    outputDirectory,
    `order-${orderNumber}-cover.pdf`
  );

  await createInteriorPDF({
    outputPath: interiorPath,
    journalTitle,
    bodyPrompt,
    footerQuote,
  });

  await createCoverPDF({
    outputPath: coverPath,
    journalTitle,
    footerQuote,
  });

  return {
    interiorPath,
    coverPath,
  };
}

async function createInteriorPDF({
  outputPath,
  journalTitle,
  bodyPrompt,
  footerQuote,
}) {
  const pdfDocument = await PDFDocument.create();
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);

  for (let day = 1; day <= 5; day += 1) {
    const page = pdfDocument.addPage([495, 756]);

    page.drawText(journalTitle, {
      x: 50,
      y: 700,
      size: 20,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });

    page.drawText(`Day ${day}`, {
      x: 50,
      y: 665,
      size: 14,
      font: boldFont,
    });

    page.drawText(bodyPrompt, {
      x: 50,
      y: 625,
      size: 11,
      font,
      maxWidth: 395,
      lineHeight: 15,
    });

    for (let y = 570; y >= 120; y -= 24) {
      page.drawLine({
        start: { x: 50, y },
        end: { x: 445, y },
        thickness: 0.5,
        color: rgb(0.75, 0.75, 0.75),
      });
    }

    if (footerQuote) {
      page.drawText(footerQuote, {
        x: 50,
        y: 70,
        size: 9,
        font,
        maxWidth: 395,
      });
    }
  }

  const pdfBytes = await pdfDocument.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

async function createCoverPDF({
  outputPath,
  journalTitle,
  footerQuote,
}) {
  const pdfDocument = await PDFDocument.create();
  const page = pdfDocument.addPage([1044, 495]);

  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: 1044,
    height: 495,
    color: rgb(0.96, 0.94, 0.9),
  });

  page.drawText(journalTitle, {
    x: 610,
    y: 260,
    size: 28,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
    maxWidth: 330,
  });

  if (footerQuote) {
    page.drawText(footerQuote, {
      x: 610,
      y: 210,
      size: 12,
      font,
      maxWidth: 330,
    });
  }

  const pdfBytes = await pdfDocument.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

module.exports = {
  generateJournalPDFs,
};