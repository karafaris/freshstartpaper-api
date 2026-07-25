const fs = require("fs");
const path = require("path");

const {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
} = require("pdf-lib");

const MM_TO_POINTS = 72 / 25.4;

const INTERIOR_WIDTH = 263 * MM_TO_POINTS;
const INTERIOR_HEIGHT = 174 * MM_TO_POINTS;

const COVER_WIDTH = 544.8 * MM_TO_POINTS;
const COVER_HEIGHT = 174 * MM_TO_POINTS;

const BLACK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.42, 0.42, 0.42);
const LIGHT_GRAY = rgb(0.82, 0.82, 0.82);
const DEFAULT_ACCENT = rgb(0.59, 0.83, 0.37);

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function propertiesToObject(lineItem) {
  const result = {};

  for (const property of lineItem?.properties || []) {
    if (!property?.name) {
      continue;
    }

    result[property.name] = property.value;
    result[normalizeKey(property.name)] =
      property.value;
  }

  return result;
}

function getProperty(
  properties,
  possibleNames,
  fallback = ""
) {
  for (const name of possibleNames) {
    if (
      properties[name] !== undefined &&
      properties[name] !== null &&
      String(properties[name]).trim() !== ""
    ) {
      return String(properties[name]).trim();
    }

    const normalizedName = normalizeKey(name);

    if (
      properties[normalizedName] !== undefined &&
      properties[normalizedName] !== null &&
      String(properties[normalizedName]).trim() !== ""
    ) {
      return String(
        properties[normalizedName]
      ).trim();
    }
  }

  return fallback;
}

function parseDate(value) {
  if (!value) {
    return new Date();
  }

  const dateOnlyMatch = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return new Date();
  }

  return parsedDate;
}

function addDays(date, numberOfDays) {
  const result = new Date(date);

  result.setDate(
    result.getDate() + numberOfDays
  );

  return result;
}

function formatDate(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function parseHexColor(
  value,
  fallback = DEFAULT_ACCENT
) {
  if (!value) {
    return fallback;
  }

  const cleaned = String(value)
    .trim()
    .replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return fallback;
  }

  const red =
    parseInt(cleaned.slice(0, 2), 16) / 255;

  const green =
    parseInt(cleaned.slice(2, 4), 16) / 255;

  const blue =
    parseInt(cleaned.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
}

function initialsFromName(name) {
  if (!name) {
    return "";
  }

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) =>
      word.charAt(0).toUpperCase()
    )
    .join("");
}

function sanitizeFileValue(value, fallback) {
  const sanitized = String(
    value || fallback
  ).replace(/[^a-zA-Z0-9-_]/g, "-");

  return sanitized || fallback;
}

function drawWrappedText({
  page,
  text,
  x,
  y,
  maxWidth,
  font,
  size,
  lineHeight = size * 1.25,
  color = BLACK,
  maxLines = 3,
}) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const proposedLine = currentLine
      ? `${currentLine} ${word}`
      : word;

    const proposedWidth =
      font.widthOfTextAtSize(
        proposedLine,
        size
      );

    if (proposedWidth <= maxWidth) {
      currentLine = proposedLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }

      currentLine = word;
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (
    currentLine &&
    lines.length < maxLines
  ) {
    lines.push(currentLine);
  }

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });

  return y - lines.length * lineHeight;
}

function drawWritingLines({
  page,
  x,
  y,
  width,
  count,
  spacing,
  color = GRAY,
  thickness = 0.55,
}) {
  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const lineY = y - index * spacing;

    page.drawLine({
      start: {
        x,
        y: lineY,
      },
      end: {
        x: x + width,
        y: lineY,
      },
      thickness,
      color,
    });
  }
}

function drawSectionLabel({
  page,
  label,
  prompt,
  x,
  y,
  width,
  accentColor,
  font,
  boldFont,
}) {
  page.drawCircle({
    x: x + 2,
    y: y + 2,
    size: 2.2,
    color: accentColor,
  });

  page.drawText(
    String(label || "").toUpperCase(),
    {
      x: x + 10,
      y,
      size: 6.5,
      font: boldFont,
      color: BLACK,
    }
  );

  if (prompt) {
    drawWrappedText({
      page,
      text: prompt,
      x: x + 10,
      y: y - 13,
      maxWidth: width - 10,
      font,
      size: 5.3,
      lineHeight: 7,
      color: BLACK,
      maxLines: 2,
    });
  }
}

function createJournalConfiguration(
  order,
  lineItem
) {
  const properties =
    propertiesToObject(lineItem);

  const customerName = [
    order.customer?.first_name,
    order.customer?.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  const journalTitle = getProperty(
    properties,
    [
      "Journal title",
      "Journal Title",
      "Title",
    ],
    "My Journal"
  );

  const ownerName = getProperty(
    properties,
    [
      "Owner name or initials",
      "Owner Name or Initials",
      "Owner name",
      "Owner",
      "Initials",
    ],
    customerName
  );

  const initials =
    getProperty(
      properties,
      [
        "Owner initials",
        "Owner Initials",
        "Initials",
      ],
      ""
    ) || initialsFromName(ownerName);

  const subtitle = getProperty(
    properties,
    [
      "Cover subtitle",
      "Cover Subtitle",
      "Subtitle",
    ],
    ""
  );

  const footerQuote = getProperty(
    properties,
    [
      "Footer quote",
      "Footer Quote",
      "Quote",
    ],
    ""
  );

  const startDateText = getProperty(
    properties,
    [
      "Journal start date",
      "Journal Start Date",
      "Start date",
      "Start Date",
    ],
    formatDate(new Date())
  );

  const dailyFeelingPrompt = getProperty(
    properties,
    [
      "Daily feeling prompt",
      "Daily Feeling Prompt",
      "Today's Feeling",
      "Todays Feeling",
    ],
    "How are you feeling today?"
  );

  const dailyIntentionPrompt = getProperty(
    properties,
    [
      "Daily intention prompt",
      "Daily Intention Prompt",
      "Today's Goal",
      "Todays Goal",
      "Daily goal prompt",
      "Daily Goal Prompt",
    ],
    "What is your goal today?"
  );

  const morningReflectionPrompt =
    getProperty(
      properties,
      [
        "Morning reflection prompt",
        "Morning Reflection Prompt",
      ],
      ""
    );

  const eveningReflectionPrompt =
    getProperty(
      properties,
      [
        "Evening reflection prompt",
        "Evening Reflection Prompt",
      ],
      ""
    );

  const careQuestionOne = getProperty(
    properties,
    [
      "Care question one",
      "Care Question One",
    ],
    ""
  );

  const careQuestionTwo = getProperty(
    properties,
    [
      "Care question two",
      "Care Question Two",
    ],
    ""
  );

  const bodyNotesPrompt = getProperty(
    properties,
    [
      "Body notes prompt",
      "Body Notes Prompt",
      "Notes prompt",
      "Notes Prompt",
    ],
    ""
  );

  const accentColorText = getProperty(
    properties,
    [
      "Accent color",
      "Accent Color",
    ],
    "#96d35f"
  );

  const coverColorText = getProperty(
    properties,
    [
      "Cover color",
      "Cover Color",
    ],
    "#171511"
  );

  return {
    journalTitle,
    ownerName,
    initials,
    subtitle,
    footerQuote,
    startDate: parseDate(startDateText),
    dailyFeelingPrompt,
    dailyIntentionPrompt,
    morningReflectionPrompt,
    eveningReflectionPrompt,
    careQuestionOne,
    careQuestionTwo,
    bodyNotesPrompt,
    accentColor: parseHexColor(
      accentColorText,
      DEFAULT_ACCENT
    ),
    coverColor: parseHexColor(
      coverColorText,
      rgb(0.09, 0.08, 0.07)
    ),
  };
}

async function generateJournalPDFs(
  order,
  lineItem
) {
  if (!order) {
    throw new Error(
      "A Shopify order is required"
    );
  }

  if (!lineItem) {
    throw new Error(
      "A Shopify line item is required for PDF generation"
    );
  }

  if (!lineItem.id) {
    throw new Error(
      "The Shopify line item does not have an ID"
    );
  }

  const outputDirectory = path.join(
    __dirname,
    "..",
    "generated"
  );

  await fs.promises.mkdir(
    outputDirectory,
    {
      recursive: true,
    }
  );

  const orderNumber =
    order.order_number ||
    order.id ||
    Date.now();

  const configuration =
    createJournalConfiguration(
      order,
      lineItem
    );

  const safeOrderNumber =
    sanitizeFileValue(
      orderNumber,
      "unknown-order"
    );

  const safeItemId =
    sanitizeFileValue(
      lineItem.id,
      "unknown-item"
    );

  const interiorPath = path.join(
    outputDirectory,
    `order-${safeOrderNumber}-item-${safeItemId}-interior.pdf`
  );

  const coverPath = path.join(
    outputDirectory,
    `order-${safeOrderNumber}-item-${safeItemId}-cover.pdf`
  );

  await createInteriorPDF({
    outputPath: interiorPath,
    ...configuration,
  });

  await createCoverPDF({
    outputPath: coverPath,
    ...configuration,
  });

  return {
    interiorPath,
    coverPath,
    itemId: lineItem.id,
    orderId: order.id,
    orderNumber,
    configuration,
  };
}

async function createInteriorPDF({
  outputPath,
  journalTitle,
  ownerName,
  initials,
  subtitle,
  footerQuote,
  startDate,
  dailyFeelingPrompt,
  dailyIntentionPrompt,
  morningReflectionPrompt,
  eveningReflectionPrompt,
  careQuestionOne,
  careQuestionTwo,
  bodyNotesPrompt,
  accentColor,
}) {
  const pdfDocument =
    await PDFDocument.create();

  const font =
    await pdfDocument.embedFont(
      StandardFonts.Helvetica
    );

  const boldFont =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaBold
    );

  const italicFont =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaOblique
    );

  /*
  |--------------------------------------------------------------------------
  | Title page
  |--------------------------------------------------------------------------
  */

  const titlePage =
    pdfDocument.addPage([
      INTERIOR_WIDTH,
      INTERIOR_HEIGHT,
    ]);

  titlePage.drawText(
    initials || "",
    {
      x: 44,
      y: INTERIOR_HEIGHT - 65,
      size: 15,
      font: boldFont,
      color: accentColor,
    }
  );

  drawWrappedText({
    page: titlePage,
    text: journalTitle,
    x: 44,
    y: INTERIOR_HEIGHT - 105,
    maxWidth:
      INTERIOR_WIDTH - 88,
    font: boldFont,
    size: 30,
    lineHeight: 32,
    color: BLACK,
    maxLines: 3,
  });

  if (subtitle) {
    drawWrappedText({
      page: titlePage,
      text: subtitle.toUpperCase(),
      x: 44,
      y: INTERIOR_HEIGHT - 195,
      maxWidth:
        INTERIOR_WIDTH - 88,
      font: boldFont,
      size: 10,
      lineHeight: 13,
      color: BLACK,
      maxLines: 3,
    });
  }

  const endingDate = addDays(
    startDate,
    364
  );

  titlePage.drawText(
    "365 consecutive daily pages",
    {
      x: 44,
      y: 110,
      size: 9,
      font,
      color: BLACK,
    }
  );

  titlePage.drawText(
    `${formatDisplayDate(
      startDate
    )} - ${formatDisplayDate(
      endingDate
    )}`,
    {
      x: 44,
      y: 92,
      size: 8,
      font,
      color: BLACK,
    }
  );

  if (ownerName) {
    titlePage.drawText(
      ownerName.toUpperCase(),
      {
        x: 44,
        y: 60,
        size: 8,
        font: boldFont,
        color: BLACK,
      }
    );
  }

  if (footerQuote) {
    drawWrappedText({
      page: titlePage,
      text: footerQuote,
      x: INTERIOR_WIDTH / 2,
      y: 60,
      maxWidth:
        INTERIOR_WIDTH / 2 - 44,
      font: italicFont,
      size: 7,
      lineHeight: 9,
      color: BLACK,
      maxLines: 3,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | 365 daily pages
  |--------------------------------------------------------------------------
  */

  for (
    let dayIndex = 0;
    dayIndex < 365;
    dayIndex += 1
  ) {
    const page =
      pdfDocument.addPage([
        INTERIOR_WIDTH,
        INTERIOR_HEIGHT,
      ]);

    const currentDate = addDays(
      startDate,
      dayIndex
    );

    const dayNumber = String(
      dayIndex + 1
    ).padStart(2, "0");

    const marginX = 26;

    const contentWidth =
      INTERIOR_WIDTH -
      marginX * 2;

    const columnGap = 18;

    const columnWidth =
      (contentWidth - columnGap) /
      2;

    /*
    | Header
    */

    page.drawCircle({
      x: marginX + 2,
      y: INTERIOR_HEIGHT - 27,
      size: 2.2,
      color: accentColor,
    });

    page.drawText(
      journalTitle.toUpperCase(),
      {
        x: marginX + 10,
        y: INTERIOR_HEIGHT - 31,
        size: 10,
        font: boldFont,
        color: BLACK,
        maxWidth: 210,
      }
    );

    if (initials) {
      page.drawLine({
        start: {
          x: marginX + 205,
          y: INTERIOR_HEIGHT - 39,
        },
        end: {
          x: marginX + 205,
          y: INTERIOR_HEIGHT - 19,
        },
        thickness: 0.7,
        color: accentColor,
      });

      page.drawText(initials, {
        x: marginX + 215,
        y: INTERIOR_HEIGHT - 31,
        size: 9,
        font: boldFont,
        color: accentColor,
      });
    }

    const dateText =
      formatDate(currentDate);

    const dateWidth =
      font.widthOfTextAtSize(
        dateText,
        8
      );

    page.drawText(dateText, {
      x:
        INTERIOR_WIDTH -
        marginX -
        dateWidth -
        42,
      y: INTERIOR_HEIGHT - 31,
      size: 8,
      font,
      color: BLACK,
    });

    page.drawLine({
      start: {
        x:
          INTERIOR_WIDTH -
          marginX -
          34,
        y:
          INTERIOR_HEIGHT -
          39,
      },
      end: {
        x:
          INTERIOR_WIDTH -
          marginX -
          34,
        y:
          INTERIOR_HEIGHT -
          19,
      },
      thickness: 0.7,
      color: LIGHT_GRAY,
    });

    page.drawText(dayNumber, {
      x:
        INTERIOR_WIDTH -
        marginX -
        25,
      y: INTERIOR_HEIGHT - 31,
      size: 8,
      font,
      color: BLACK,
    });

    page.drawLine({
      start: {
        x: marginX,
        y:
          INTERIOR_HEIGHT -
          52,
      },
      end: {
        x:
          INTERIOR_WIDTH -
          marginX,
        y:
          INTERIOR_HEIGHT -
          52,
      },
      thickness: 0.8,
      color: BLACK,
    });

    /*
    | Daily feeling and intention
    */

    const upperSectionY =
      INTERIOR_HEIGHT - 79;

    drawSectionLabel({
      page,
      label: "Daily Feeling",
      prompt:
        dailyFeelingPrompt,
      x: marginX,
      y: upperSectionY,
      width: columnWidth,
      accentColor,
      font,
      boldFont,
    });

    drawWritingLines({
      page,
      x: marginX + 165,
      y:
        upperSectionY -
        4,
      width:
        columnWidth -
        165,
      count: 3,
      spacing: 14,
    });

    page.drawLine({
      start: {
        x: marginX + 155,
        y:
          upperSectionY +
          7,
      },
      end: {
        x: marginX + 155,
        y:
          upperSectionY -
          45,
      },
      thickness: 0.7,
      color: accentColor,
    });

    const rightColumnX =
      marginX +
      columnWidth +
      columnGap;

    drawSectionLabel({
      page,
      label: "Daily Intention",
      prompt:
        dailyIntentionPrompt,
      x: rightColumnX,
      y: upperSectionY,
      width: columnWidth,
      accentColor,
      font,
      boldFont,
    });

    drawWritingLines({
      page,
      x:
        rightColumnX +
        165,
      y:
        upperSectionY -
        4,
      width:
        columnWidth -
        165,
      count: 3,
      spacing: 14,
    });

    page.drawLine({
      start: {
        x:
          rightColumnX +
          155,
        y:
          upperSectionY +
          7,
      },
      end: {
        x:
          rightColumnX +
          155,
        y:
          upperSectionY -
          45,
      },
      thickness: 0.7,
      color: accentColor,
    });

    /*
    | Morning and evening reflection
    */

    const reflectionY =
      INTERIOR_HEIGHT - 175;

    drawSectionLabel({
      page,
      label:
        "Morning Reflection",
      prompt:
        morningReflectionPrompt,
      x: marginX,
      y: reflectionY,
      width: columnWidth,
      accentColor,
      font,
      boldFont,
    });

    page.drawLine({
      start: {
        x: marginX + 155,
        y:
          reflectionY +
          7,
      },
      end: {
        x: marginX + 155,
        y:
          reflectionY -
          142,
      },
      thickness: 0.7,
      color: accentColor,
    });

    drawWritingLines({
      page,
      x: marginX + 168,
      y:
        reflectionY -
        3,
      width:
        columnWidth -
        168,
      count: 9,
      spacing: 16,
    });

    drawSectionLabel({
      page,
      label:
        "Evening Reflection",
      prompt:
        eveningReflectionPrompt,
      x: rightColumnX,
      y: reflectionY,
      width: columnWidth,
      accentColor,
      font,
      boldFont,
    });

    page.drawLine({
      start: {
        x:
          rightColumnX +
          155,
        y:
          reflectionY +
          7,
      },
      end: {
        x:
          rightColumnX +
          155,
        y:
          reflectionY -
          142,
      },
      thickness: 0.7,
      color: accentColor,
    });

    drawWritingLines({
      page,
      x:
        rightColumnX +
        168,
      y:
        reflectionY -
        3,
      width:
        columnWidth -
        168,
      count: 9,
      spacing: 16,
    });

    /*
    | Bottom questions
    */

    const dividerY = 116;

    page.drawLine({
      start: {
        x: marginX,
        y: dividerY,
      },
      end: {
        x:
          INTERIOR_WIDTH -
          marginX,
        y: dividerY,
      },
      thickness: 0.5,
      color: LIGHT_GRAY,
      dashArray: [2, 2],
    });

    const bottomGap = 14;

    const bottomColumnWidth =
      (
        contentWidth -
        bottomGap * 2
      ) / 3;

    drawSectionLabel({
      page,
      label:
        "Care Question One",
      prompt: careQuestionOne,
      x: marginX,
      y: 94,
      width:
        bottomColumnWidth,
      accentColor,
      font,
      boldFont,
    });

    drawWritingLines({
      page,
      x: marginX + 10,
      y: 57,
      width:
        bottomColumnWidth -
        12,
      count: 1,
      spacing: 12,
    });

    const bottomColumnTwoX =
      marginX +
      bottomColumnWidth +
      bottomGap;

    drawSectionLabel({
      page,
      label:
        "Care Question Two",
      prompt: careQuestionTwo,
      x: bottomColumnTwoX,
      y: 94,
      width:
        bottomColumnWidth,
      accentColor,
      font,
      boldFont,
    });

    drawWritingLines({
      page,
      x:
        bottomColumnTwoX +
        10,
      y: 57,
      width:
        bottomColumnWidth -
        12,
      count: 1,
      spacing: 12,
    });

    const bottomColumnThreeX =
      bottomColumnTwoX +
      bottomColumnWidth +
      bottomGap;

    drawSectionLabel({
      page,
      label: "Body Notes",
      prompt: bodyNotesPrompt,
      x:
        bottomColumnThreeX,
      y: 94,
      width:
        bottomColumnWidth,
      accentColor,
      font,
      boldFont,
    });

    drawWritingLines({
      page,
      x:
        bottomColumnThreeX +
        10,
      y: 57,
      width:
        bottomColumnWidth -
        12,
      count: 2,
      spacing: 14,
    });

    /*
    | Footer
    */

    page.drawLine({
      start: {
        x: marginX,
        y: 30,
      },
      end: {
        x:
          INTERIOR_WIDTH -
          marginX,
        y: 30,
      },
      thickness: 0.7,
      color: BLACK,
    });

    page.drawCircle({
      x: INTERIOR_WIDTH / 2,
      y: 30,
      size: 3,
      color: accentColor,
    });

    if (footerQuote) {
      const footerSize = 6;

      const footerWidth =
        italicFont.widthOfTextAtSize(
          footerQuote,
          footerSize
        );

      page.drawText(
        footerQuote,
        {
          x: Math.max(
            marginX,
            (
              INTERIOR_WIDTH -
              footerWidth
            ) / 2
          ),
          y: 13,
          size: footerSize,
          font: italicFont,
          color: GRAY,
          maxWidth:
            contentWidth,
        }
      );
    }
  }

  const pdfBytes =
    await pdfDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

  await fs.promises.writeFile(
    outputPath,
    pdfBytes
  );
}

async function createCoverPDF({
  outputPath,
  journalTitle,
  ownerName,
  initials,
  subtitle,
  footerQuote,
  coverColor,
  accentColor,
}) {
  const pdfDocument =
    await PDFDocument.create();

  const page =
    pdfDocument.addPage([
      COVER_WIDTH,
      COVER_HEIGHT,
    ]);

  const font =
    await pdfDocument.embedFont(
      StandardFonts.Helvetica
    );

  const boldFont =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaBold
    );

  const italicFont =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaOblique
    );

  page.drawRectangle({
    x: 0,
    y: 0,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    color: coverColor,
  });

  const spineWidth =
    18.8 * MM_TO_POINTS;

  const panelWidth =
    (
      COVER_WIDTH -
      spineWidth
    ) / 2;

  const frontCoverX =
    panelWidth +
    spineWidth;

  page.drawLine({
    start: {
      x: panelWidth,
      y: 0,
    },
    end: {
      x: panelWidth,
      y: COVER_HEIGHT,
    },
    thickness: 0.3,
    color: accentColor,
    opacity: 0.2,
  });

  page.drawLine({
    start: {
      x:
        panelWidth +
        spineWidth,
      y: 0,
    },
    end: {
      x:
        panelWidth +
        spineWidth,
      y: COVER_HEIGHT,
    },
    thickness: 0.3,
    color: accentColor,
    opacity: 0.2,
  });

  const frontMargin =
    52 * MM_TO_POINTS;

  drawWrappedText({
    page,
    text: journalTitle,
    x:
      frontCoverX +
      frontMargin,
    y:
      COVER_HEIGHT -
      72 * MM_TO_POINTS,
    maxWidth:
      panelWidth -
      frontMargin * 2,
    font: boldFont,
    size: 29,
    lineHeight: 31,
    color: rgb(1, 1, 1),
    maxLines: 4,
  });

  if (subtitle) {
    drawWrappedText({
      page,
      text:
        subtitle.toUpperCase(),
      x:
        frontCoverX +
        frontMargin,
      y:
        COVER_HEIGHT -
        105 *
          MM_TO_POINTS,
      maxWidth:
        panelWidth -
        frontMargin * 2,
      font: boldFont,
      size: 9,
      lineHeight: 12,
      color: accentColor,
      maxLines: 3,
    });
  }

  if (ownerName) {
    page.drawText(
      ownerName.toUpperCase(),
      {
        x:
          frontCoverX +
          frontMargin,
        y:
          30 *
          MM_TO_POINTS,
        size: 8,
        font: boldFont,
        color: rgb(1, 1, 1),
        maxWidth:
          panelWidth -
          frontMargin * 2,
      }
    );
  }

  if (initials) {
    page.drawText(
      initials,
      {
        x:
          frontCoverX +
          frontMargin,
        y:
          COVER_HEIGHT -
          38 *
            MM_TO_POINTS,
        size: 15,
        font: boldFont,
        color: accentColor,
      }
    );
  }

  if (footerQuote) {
    drawWrappedText({
      page,
      text: footerQuote,
      x:
        35 *
        MM_TO_POINTS,
      y:
        30 *
        MM_TO_POINTS,
      maxWidth:
        panelWidth -
        70 *
          MM_TO_POINTS,
      font: italicFont,
      size: 7,
      lineHeight: 10,
      color: rgb(1, 1, 1),
      maxLines: 4,
    });
  }

  const spineText =
    journalTitle.length > 45
      ? journalTitle.slice(
          0,
          45
        )
      : journalTitle;

  const spineFontSize = 9;

  const spineTextWidth =
    boldFont.widthOfTextAtSize(
      spineText.toUpperCase(),
      spineFontSize
    );

  page.drawText(
    spineText.toUpperCase(),
    {
      x:
        panelWidth +
        spineWidth / 2 -
        spineFontSize / 2,
      y:
        (
          COVER_HEIGHT -
          spineTextWidth
        ) / 2,
      size: spineFontSize,
      font: boldFont,
      color: rgb(1, 1, 1),
      rotate: degrees(90),
    }
  );

  const pdfBytes =
    await pdfDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

  await fs.promises.writeFile(
    outputPath,
    pdfBytes
  );
}

module.exports = {
  generateJournalPDFs,
};