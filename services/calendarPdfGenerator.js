const fs = require("fs");
const path = require("path");
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require("pdf-lib");

const MM_TO_POINTS = 72 / 25.4;
const PAGE_WIDTH = 216 * MM_TO_POINTS;
const PAGE_HEIGHT = 154 * MM_TO_POINTS;
const BLEED = 3 * MM_TO_POINTS;
const SAFE_MARGIN = 10 * MM_TO_POINTS;

function clean(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertiesToObject(lineItem) {
  const result = {};

  for (const property of lineItem?.properties || []) {
    if (!property?.name) continue;
    result[property.name] = property.value;
    result[normalizeKey(property.name)] = property.value;
  }

  return result;
}

function getProperty(properties, names, fallback = "") {
  for (const name of names) {
    const direct = properties[name];
    const normalized = properties[normalizeKey(name)];
    const value = direct ?? normalized;

    if (clean(value)) return clean(value);
  }

  return fallback;
}

function parseHexColor(value, fallback) {
  const cleaned = clean(value).replace("#", "");

  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return fallback;

  return rgb(
    parseInt(cleaned.slice(0, 2), 16) / 255,
    parseInt(cleaned.slice(2, 4), 16) / 255,
    parseInt(cleaned.slice(4, 6), 16) / 255
  );
}

function sanitize(value, fallback) {
  return clean(value, fallback).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function fitText(font, text, maxWidth, preferred, minimum = 10) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function drawCentered(page, text, y, font, size, color) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_WIDTH - width) / 2,
    y,
    font,
    size,
    color,
  });
}

function drawCover({ page, fonts, calendarTitle, ownerName, year, accent, background }) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: background });
  page.drawRectangle({
    x: BLEED + SAFE_MARGIN,
    y: BLEED + SAFE_MARGIN,
    width: PAGE_WIDTH - 2 * (BLEED + SAFE_MARGIN),
    height: PAGE_HEIGHT - 2 * (BLEED + SAFE_MARGIN),
    borderColor: accent,
    borderWidth: 1.4,
  });

  const titleSize = fitText(fonts.bold, calendarTitle, PAGE_WIDTH - 50 * MM_TO_POINTS, 34, 18);
  drawCentered(page, calendarTitle, PAGE_HEIGHT * 0.60, fonts.bold, titleSize, accent);
  drawCentered(page, String(year), PAGE_HEIGHT * 0.43, fonts.regular, 25, rgb(0.18, 0.16, 0.14));

  if (ownerName) {
    const ownerSize = fitText(fonts.regular, ownerName, PAGE_WIDTH - 55 * MM_TO_POINTS, 13, 9);
    drawCentered(page, ownerName, PAGE_HEIGHT * 0.25, fonts.regular, ownerSize, rgb(0.30, 0.27, 0.23));
  }

  drawCentered(page, "FRESH START PAPER", BLEED + SAFE_MARGIN + 4 * MM_TO_POINTS, fonts.bold, 7, accent);
}

function mondayFirstWeekday(year, month) {
  const sundayBased = new Date(year, month, 1).getDay();
  return (sundayBased + 6) % 7;
}

function drawMonth({ page, fonts, year, month, accent, background, notesLabel }) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: background });

  const monthName = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long" });
  page.drawText(monthName.toUpperCase(), {
    x: BLEED + SAFE_MARGIN,
    y: PAGE_HEIGHT - BLEED - SAFE_MARGIN - 10 * MM_TO_POINTS,
    font: fonts.bold,
    size: 24,
    color: accent,
  });

  const yearText = String(year);
  page.drawText(yearText, {
    x: PAGE_WIDTH - BLEED - SAFE_MARGIN - fonts.regular.widthOfTextAtSize(yearText, 13),
    y: PAGE_HEIGHT - BLEED - SAFE_MARGIN - 7 * MM_TO_POINTS,
    font: fonts.regular,
    size: 13,
    color: rgb(0.28, 0.25, 0.22),
  });

  const gridX = BLEED + SAFE_MARGIN;
  const gridY = BLEED + SAFE_MARGIN + 18 * MM_TO_POINTS;
  const gridWidth = PAGE_WIDTH - 2 * (BLEED + SAFE_MARGIN);
  const gridHeight = PAGE_HEIGHT - 2 * (BLEED + SAFE_MARGIN) - 35 * MM_TO_POINTS;
  const cellWidth = gridWidth / 7;
  const headerHeight = 8 * MM_TO_POINTS;
  const rowHeight = (gridHeight - headerHeight) / 6;
  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  page.drawRectangle({ x: gridX, y: gridY + gridHeight - headerHeight, width: gridWidth, height: headerHeight, color: accent });

  weekdays.forEach((day, index) => {
    const width = fonts.bold.widthOfTextAtSize(day, 7);
    page.drawText(day, {
      x: gridX + index * cellWidth + (cellWidth - width) / 2,
      y: gridY + gridHeight - headerHeight + 2.6 * MM_TO_POINTS,
      font: fonts.bold,
      size: 7,
      color: rgb(1, 1, 1),
    });
  });

  const lineColor = rgb(0.79, 0.76, 0.71);
  for (let column = 0; column <= 7; column += 1) {
    const x = gridX + column * cellWidth;
    page.drawLine({ start: { x, y: gridY }, end: { x, y: gridY + gridHeight }, thickness: 0.45, color: lineColor });
  }
  for (let row = 0; row <= 6; row += 1) {
    const y = gridY + row * rowHeight;
    page.drawLine({ start: { x: gridX, y }, end: { x: gridX + gridWidth, y }, thickness: 0.45, color: lineColor });
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingCell = mondayFirstWeekday(year, month);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellIndex = startingCell + day - 1;
    const column = cellIndex % 7;
    const rowFromTop = Math.floor(cellIndex / 7);
    const x = gridX + column * cellWidth + 2.2 * MM_TO_POINTS;
    const y = gridY + gridHeight - headerHeight - (rowFromTop + 1) * rowHeight + rowHeight - 5 * MM_TO_POINTS;
    page.drawText(String(day), { x, y, font: fonts.bold, size: 8, color: rgb(0.18, 0.16, 0.14) });
  }

  page.drawText(notesLabel, {
    x: gridX,
    y: BLEED + SAFE_MARGIN + 6 * MM_TO_POINTS,
    font: fonts.bold,
    size: 8,
    color: accent,
  });
  page.drawLine({
    start: { x: gridX + 18 * MM_TO_POINTS, y: BLEED + SAFE_MARGIN + 6.5 * MM_TO_POINTS },
    end: { x: gridX + gridWidth, y: BLEED + SAFE_MARGIN + 6.5 * MM_TO_POINTS },
    thickness: 0.55,
    color: lineColor,
  });
}

async function generateCalendarPDFs(order, lineItem) {
  const properties = propertiesToObject(lineItem);
  const startDateValue = getProperty(properties, ["Calendar start date", "Start date", "Year"], "");
  const parsedDate = startDateValue ? new Date(startDateValue) : new Date();
  const requestedYear = Number(getProperty(properties, ["Calendar year", "Year"], ""));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200
    ? requestedYear
    : (Number.isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear());

  const calendarTitle = getProperty(properties, ["Calendar title", "Title"], "A Fresh Start");
  const ownerName = getProperty(properties, ["Owner name", "Name", "Name or initials", "Initials"], "");
  const notesLabel = getProperty(properties, ["Notes label", "Footer prompt"], "NOTES");
  const accent = parseHexColor(getProperty(properties, ["Accent color", "Accent"], "#B58A50"), rgb(0.71, 0.54, 0.31));
  const background = parseHexColor(getProperty(properties, ["Background color", "Cover color"], "#FAF7F0"), rgb(0.98, 0.97, 0.94));

  const outputDirectory = path.join(__dirname, "..", "generated");
  await fs.promises.mkdir(outputDirectory, { recursive: true });

  const orderId = sanitize(order?.id, "order");
  const itemId = sanitize(lineItem?.id, "item");
  const productPath = path.join(outputDirectory, `calendar-${orderId}-${itemId}.pdf`);

  const pdfDocument = await PDFDocument.create();
  const fonts = {
    regular: await pdfDocument.embedFont(StandardFonts.Helvetica),
    bold: await pdfDocument.embedFont(StandardFonts.HelveticaBold),
  };

  drawCover({
    page: pdfDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts,
    calendarTitle,
    ownerName,
    year,
    accent,
    background,
  });

  for (let month = 0; month < 12; month += 1) {
    drawMonth({
      page: pdfDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      fonts,
      year,
      month,
      accent,
      background,
      notesLabel,
    });
  }

  const pdfBytes = await pdfDocument.save({ useObjectStreams: true, addDefaultPage: false });
  await fs.promises.writeFile(productPath, pdfBytes);

  return {
    productPath,
    totalPages: 13,
    dimensions: { widthMm: 216, heightMm: 154, bleedMm: 3 },
  };
}

module.exports = { generateCalendarPDFs };
