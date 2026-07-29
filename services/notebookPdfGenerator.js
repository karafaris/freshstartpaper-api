const fs = require("fs");
const path = require("path");
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require("pdf-lib");

const MM_TO_POINTS = 72 / 25.4;

/*
|--------------------------------------------------------------------------
| Cloudprinter production dimensions
|--------------------------------------------------------------------------
|
| Finished trim:
| 420 x 297 mm
|
| Required bleed:
| 3 mm on every side
|
| Generated PDF:
| 426 x 303 mm
|
*/

const TRIM_WIDTH_MM = 420;
const TRIM_HEIGHT_MM = 297;
const BLEED_MM = 3;

const PDF_WIDTH_MM =
  TRIM_WIDTH_MM + BLEED_MM * 2;

const PDF_HEIGHT_MM =
  TRIM_HEIGHT_MM + BLEED_MM * 2;

const PAGE_WIDTH =
  PDF_WIDTH_MM * MM_TO_POINTS;

const PAGE_HEIGHT =
  PDF_HEIGHT_MM * MM_TO_POINTS;

const NOTEBOOK_TOTAL_PAGES = 365;
const COVER_TOTAL_PAGES = 2;

const DEFAULTS = Object.freeze({
  notebookTitle: "My Notebook",

  ownerName:
    "Personalized for you",

  subtitle:
    "Ideas, notes and everything in between",

  typographyStyle:
    "Elegant serif",

  coverBorderStyle:
    "No border",

  coverColor:
    "#6f5948",

  accentColor:
    "#d5b574",

  coverTextColor:
    "#fffaf2",

  interiorPageStyle:
    "Lined",

  pageHeader:
    "Notes",

  pageNumberStyle:
    "Page 1",

  pagePrompt:
    "Write what you do not want to forget.",

  paperColor:
    "#fffdf8",

  lineColor:
    "#d8c8ba",

  footerPhrase:
    "Ideas become real when they are written down.",
});

function clean(
  value,
  fallback = ""
) {
  const result = String(
    value ?? ""
  ).trim();

  return result || fallback;
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

/*
|--------------------------------------------------------------------------
| Shopify line-item properties
|--------------------------------------------------------------------------
*/

function propertiesToObject(
  lineItem
) {
  const result = {};
  const properties =
    lineItem?.properties;

  if (
    Array.isArray(properties)
  ) {
    for (
      const property
      of properties
    ) {
      if (
        !property?.name
      ) {
        continue;
      }

      result[property.name] =
        property.value;

      result[
        normalizeKey(
          property.name
        )
      ] = property.value;
    }

    return result;
  }

  if (
    properties &&
    typeof properties ===
      "object"
  ) {
    for (
      const [name, value]
      of Object.entries(
        properties
      )
    ) {
      result[name] = value;

      result[
        normalizeKey(name)
      ] = value;
    }
  }

  return result;
}

function getProperty(
  properties,
  possibleNames,
  fallback = ""
) {
  for (
    const name
    of possibleNames
  ) {
    const directValue =
      properties[name];

    if (
      directValue !==
        undefined &&
      directValue !== null
    ) {
      const cleaned =
        clean(directValue);

      if (cleaned) {
        return cleaned;
      }
    }

    const normalizedValue =
      properties[
        normalizeKey(name)
      ];

    if (
      normalizedValue !==
        undefined &&
      normalizedValue !== null
    ) {
      const cleaned =
        clean(
          normalizedValue
        );

      if (cleaned) {
        return cleaned;
      }
    }
  }

  return fallback;
}

/*
|--------------------------------------------------------------------------
| Text safety
|--------------------------------------------------------------------------
|
| Standard PDF fonts cannot print every emoji or Unicode symbol.
| This prevents unsupported characters from crashing an order.
|
*/

function sanitizePdfText(
  value,
  fallback = ""
) {
  return clean(
    value,
    fallback
  )
    .normalize("NFKD")
    .replace(
      /[\u2018\u2019]/g,
      "'"
    )
    .replace(
      /[\u201C\u201D]/g,
      "\""
    )
    .replace(
      /[\u2013\u2014]/g,
      "-"
    )
    .replace(
      /\u2026/g,
      "..."
    )
    .replace(
      /\u00D7/g,
      "x"
    )
    .replace(
      /\u00A0/g,
      " "
    )
    .replace(
      /[^\x20-\x7E\n\r\t]/g,
      ""
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .trim();
}

function safeFilePart(
  value,
  fallback
) {
  const result = clean(
    value,
    fallback
  )
    .replace(
      /[^a-zA-Z0-9-_]/g,
      "-"
    )
    .replace(
      /-+/g,
      "-"
    )
    .replace(
      /^-|-$/g,
      ""
    );

  return result || fallback;
}

/*
|--------------------------------------------------------------------------
| Colors
|--------------------------------------------------------------------------
*/

function parseHexColor(
  value,
  fallbackHex
) {
  const fallback = clean(
    fallbackHex,
    "#000000"
  );

  const input = clean(
    value,
    fallback
  );

  const normalized =
    input.startsWith("#")
      ? input.slice(1)
      : input;

  const valid =
    /^[0-9a-fA-F]{6}$/.test(
      normalized
    )
      ? normalized
      : fallback.replace(
          /^#/,
          ""
        );

  return rgb(
    parseInt(
      valid.slice(0, 2),
      16
    ) / 255,

    parseInt(
      valid.slice(2, 4),
      16
    ) / 255,

    parseInt(
      valid.slice(4, 6),
      16
    ) / 255
  );
}

/*
|--------------------------------------------------------------------------
| Initials
|--------------------------------------------------------------------------
*/

function initialsFromName(
  value
) {
  const words =
    sanitizePdfText(value)
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return "MN";
  }

  if (
    words.length === 1
  ) {
    return words[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    words[0][0] +
    words[
      words.length - 1
    ][0]
  ).toUpperCase();
}

/*
|--------------------------------------------------------------------------
| Text wrapping
|--------------------------------------------------------------------------
*/

function splitLongWord({
  word,
  font,
  size,
  maxWidth,
}) {
  const pieces = [];
  let current = "";

  for (
    const character
    of word
  ) {
    const candidate =
      current + character;

    if (
      current &&
      font.widthOfTextAtSize(
        candidate,
        size
      ) > maxWidth
    ) {
      pieces.push(
        current
      );

      current =
        character;
    } else {
      current =
        candidate;
    }
  }

  if (current) {
    pieces.push(
      current
    );
  }

  return pieces;
}

function wrapText({
  text,
  font,
  size,
  maxWidth,
}) {
  const normalizedText =
    sanitizePdfText(text);

  if (!normalizedText) {
    return [];
  }

  const paragraphs =
    normalizedText.split(
      /\r?\n/
    );

  const lines = [];

  for (
    const paragraph
    of paragraphs
  ) {
    const words =
      paragraph
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) {
      lines.push("");
      continue;
    }

    let currentLine = "";

    for (
      const originalWord
      of words
    ) {
      const wordParts =
        font.widthOfTextAtSize(
          originalWord,
          size
        ) > maxWidth
          ? splitLongWord({
              word:
                originalWord,
              font,
              size,
              maxWidth,
            })
          : [originalWord];

      for (
        const word
        of wordParts
      ) {
        const candidate =
          currentLine
            ? `${currentLine} ${word}`
            : word;

        if (
          currentLine &&
          font.widthOfTextAtSize(
            candidate,
            size
          ) > maxWidth
        ) {
          lines.push(
            currentLine
          );

          currentLine =
            word;
        } else {
          currentLine =
            candidate;
        }
      }
    }

    if (currentLine) {
      lines.push(
        currentLine
      );
    }
  }

  return lines;
}

function fitTextBlock({
  text,
  font,
  maxWidth,
  maxLines,
  preferredSize,
  minimumSize,
}) {
  const safeText =
    sanitizePdfText(text);

  for (
    let size =
      preferredSize;
    size >= minimumSize;
    size -= 1
  ) {
    const lines =
      wrapText({
        text: safeText,
        font,
        size,
        maxWidth,
      });

    if (
      lines.length <=
      maxLines
    ) {
      return {
        size,
        lines,
      };
    }
  }

  const size =
    minimumSize;

  const lines =
    wrapText({
      text: safeText,
      font,
      size,
      maxWidth,
    }).slice(
      0,
      maxLines
    );

  if (lines.length) {
    let lastLine =
      lines[
        lines.length - 1
      ];

    while (
      lastLine &&
      font.widthOfTextAtSize(
        `${lastLine}...`,
        size
      ) > maxWidth
    ) {
      lastLine =
        lastLine
          .slice(0, -1)
          .trimEnd();
    }

    lines[
      lines.length - 1
    ] = `${lastLine}...`;
  }

  return {
    size,
    lines,
  };
}

function drawTextLines({
  page,
  lines,
  x,
  y,
  font,
  size,
  lineHeight,
  color,
  align = "left",
  maxWidth = 0,
}) {
  let currentY = y;

  for (
    const line
    of lines
  ) {
    let drawX = x;

    const lineWidth =
      font.widthOfTextAtSize(
        line,
        size
      );

    if (
      align === "center"
    ) {
      drawX =
        x +
        (
          maxWidth -
          lineWidth
        ) /
          2;
    } else if (
      align === "right"
    ) {
      drawX =
        x +
        maxWidth -
        lineWidth;
    }

    page.drawText(
      line,
      {
        x: drawX,
        y: currentY,
        size,
        font,
        color,
      }
    );

    currentY -=
      lineHeight;
  }

  return currentY;
}

/*
|--------------------------------------------------------------------------
| Read notebook configuration
|--------------------------------------------------------------------------
*/

function createNotebookConfiguration(
  lineItem
) {
  const properties =
    propertiesToObject(
      lineItem
    );

  return {
    notebookTitle:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Notebook title",
            "Notebook Title",
            "Title",
          ],
          DEFAULTS.notebookTitle
        ),
        DEFAULTS.notebookTitle
      ),

    ownerName:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Owner name or initials",
            "Owner Name or Initials",
            "Owner name",
            "Owner initials",
            "Name or initials",
          ],
          DEFAULTS.ownerName
        ),
        DEFAULTS.ownerName
      ),

    subtitle:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Cover subtitle",
            "Cover Subtitle",
            "Subtitle",
          ],
          DEFAULTS.subtitle
        )
      ),

    typographyStyle:
      getProperty(
        properties,
        [
          "Typography style",
          "Typography Style",
          "Font style",
        ],
        DEFAULTS.typographyStyle
      ),

    coverBorderStyle:
      getProperty(
        properties,
        [
          "Cover border style",
          "Cover Border Style",
          "Cover border",
          "Border style",
        ],
        DEFAULTS.coverBorderStyle
      ),

    coverColorHex:
      getProperty(
        properties,
        [
          "Cover color",
          "Cover Color",
        ],
        DEFAULTS.coverColor
      ),

    accentColorHex:
      getProperty(
        properties,
        [
          "Accent or foil color",
          "Accent Or Foil Color",
          "Accent color",
          "Accent Color",
        ],
        DEFAULTS.accentColor
      ),

    coverTextColorHex:
      getProperty(
        properties,
        [
          "Cover text color",
          "Cover Text Color",
          "Text color",
        ],
        DEFAULTS.coverTextColor
      ),

    interiorPageStyle:
      getProperty(
        properties,
        [
          "Interior page style",
          "Interior Page Style",
          "Inside page style",
          "Page style",
        ],
        DEFAULTS.interiorPageStyle
      ),

    pageHeader:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Page header",
            "Page Header",
            "Header",
          ],
          DEFAULTS.pageHeader
        ),
        DEFAULTS.pageHeader
      ),

    pageNumberStyle:
      getProperty(
        properties,
        [
          "Page number style",
          "Page Number Style",
          "Page-number style",
        ],
        DEFAULTS.pageNumberStyle
      ),

    pagePrompt:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Optional page prompt",
            "Page prompt",
            "Notebook prompt",
            "Prompt",
          ],
          DEFAULTS.pagePrompt
        )
      ),

    paperColorHex:
      getProperty(
        properties,
        [
          "Interior paper color",
          "Interior Paper Color",
          "Paper color",
        ],
        DEFAULTS.paperColor
      ),

    lineColorHex:
      getProperty(
        properties,
        [
          "Line or grid color",
          "Line Or Grid Color",
          "Line color",
          "Grid color",
        ],
        DEFAULTS.lineColor
      ),

    footerPhrase:
      sanitizePdfText(
        getProperty(
          properties,
          [
            "Page footer phrase",
            "Page Footer Phrase",
            "Footer phrase",
            "Footer quote",
          ],
          DEFAULTS.footerPhrase
        )
      ),
  };
}

/*
|--------------------------------------------------------------------------
| Normalize customer selections
|--------------------------------------------------------------------------
*/

function normalizePageStyle(
  value
) {
  const normalized =
    normalizeKey(value);

  if (
    normalized.includes(
      "dot"
    )
  ) {
    return "dot-grid";
  }

  if (
    normalized.includes(
      "graph"
    ) ||
    normalized.includes(
      "grid"
    )
  ) {
    return "graph-grid";
  }

  if (
    normalized.includes(
      "blank"
    )
  ) {
    return "blank";
  }

  return "lined";
}

function normalizeTypographyStyle(
  value
) {
  const normalized =
    normalizeKey(value);

  if (
    normalized.includes(
      "sans"
    ) ||
    normalized.includes(
      "modern"
    )
  ) {
    return "modern-sans";
  }

  if (
    normalized.includes(
      "script"
    ) ||
    normalized.includes(
      "soft"
    )
  ) {
    return "soft-script";
  }

  return "elegant-serif";
}

function normalizeBorderStyle(
  value
) {
  const normalized =
    normalizeKey(value);

  if (
    normalized.includes(
      "double"
    )
  ) {
    return "double";
  }

  if (
    normalized.includes(
      "corner"
    )
  ) {
    return "corner-accents";
  }

  if (
    normalized.includes(
      "thin"
    ) ||
    normalized === "border"
  ) {
    return "thin";
  }

  return "none";
}

function formatPageNumber(
  pageNumber,
  style
) {
  const normalized =
    normalizeKey(style);

  if (
    normalized.includes(
      "no"
    ) ||
    normalized.includes(
      "none"
    )
  ) {
    return "";
  }

  if (
    normalized === "01" ||
    normalized.includes(
      "twodigit"
    )
  ) {
    return String(
      pageNumber
    ).padStart(
      2,
      "0"
    );
  }

  return `Page ${pageNumber}`;
}

/*
|--------------------------------------------------------------------------
| Cover border
|--------------------------------------------------------------------------
*/

function drawCoverBorder({
  page,
  borderStyle,
  accentColor,
}) {
  const trimX =
    BLEED_MM *
    MM_TO_POINTS;

  const trimY =
    BLEED_MM *
    MM_TO_POINTS;

  const inset =
    11 *
    MM_TO_POINTS;

  const x =
    trimX + inset;

  const y =
    trimY + inset;

  const width =
    TRIM_WIDTH_MM *
      MM_TO_POINTS -
    inset * 2;

  const height =
    TRIM_HEIGHT_MM *
      MM_TO_POINTS -
    inset * 2;

  if (
    borderStyle === "none"
  ) {
    return;
  }

  if (
    borderStyle === "thin"
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor:
        accentColor,
      borderWidth: 1.2,
    });

    return;
  }

  if (
    borderStyle ===
    "double"
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor:
        accentColor,
      borderWidth: 1.2,
    });

    const secondInset =
      3 *
      MM_TO_POINTS;

    page.drawRectangle({
      x:
        x +
        secondInset,

      y:
        y +
        secondInset,

      width:
        width -
        secondInset * 2,

      height:
        height -
        secondInset * 2,

      borderColor:
        accentColor,

      borderWidth: 0.8,
    });

    return;
  }

  const cornerLength =
    22 *
    MM_TO_POINTS;

  const lineWidth = 1.4;

  const corners = [
    {
      horizontal: [
        x,
        y + height,
        x + cornerLength,
        y + height,
      ],

      vertical: [
        x,
        y + height,
        x,
        y +
          height -
          cornerLength,
      ],
    },

    {
      horizontal: [
        x +
          width -
          cornerLength,
        y + height,
        x + width,
        y + height,
      ],

      vertical: [
        x + width,
        y + height,
        x + width,
        y +
          height -
          cornerLength,
      ],
    },

    {
      horizontal: [
        x,
        y,
        x + cornerLength,
        y,
      ],

      vertical: [
        x,
        y,
        x,
        y + cornerLength,
      ],
    },

    {
      horizontal: [
        x +
          width -
          cornerLength,
        y,
        x + width,
        y,
      ],

      vertical: [
        x + width,
        y,
        x + width,
        y + cornerLength,
      ],
    },
  ];

  for (
    const corner
    of corners
  ) {
    page.drawLine({
      start: {
        x:
          corner
            .horizontal[0],

        y:
          corner
            .horizontal[1],
      },

      end: {
        x:
          corner
            .horizontal[2],

        y:
          corner
            .horizontal[3],
      },

      thickness:
        lineWidth,

      color:
        accentColor,
    });

    page.drawLine({
      start: {
        x:
          corner
            .vertical[0],

        y:
          corner
            .vertical[1],
      },

      end: {
        x:
          corner
            .vertical[2],

        y:
          corner
            .vertical[3],
      },

      thickness:
        lineWidth,

      color:
        accentColor,
    });
  }
}

/*
|--------------------------------------------------------------------------
| Two-page cover PDF
|--------------------------------------------------------------------------
|
| Page 1: Front cover
| Page 2: Back cover
|
*/

async function createCoverPDF({
  outputPath,
  configuration,
}) {
  const pdfDocument =
    await PDFDocument.create();

  pdfDocument.setTitle(
    `${configuration.notebookTitle} - cover`
  );

  pdfDocument.setAuthor(
    "Fresh Start Paper"
  );

  pdfDocument.setSubject(
    "A3 landscape coil-bound notebook front and back cover"
  );

  pdfDocument.setProducer(
    "Fresh Start Paper API"
  );

  pdfDocument.setCreator(
    "Fresh Start Paper API"
  );

  const helvetica =
    await pdfDocument.embedFont(
      StandardFonts.Helvetica
    );

  const helveticaBold =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaBold
    );

  const timesRoman =
    await pdfDocument.embedFont(
      StandardFonts.TimesRoman
    );

  const timesBold =
    await pdfDocument.embedFont(
      StandardFonts.TimesRomanBold
    );

  const timesItalic =
    await pdfDocument.embedFont(
      StandardFonts.TimesRomanItalic
    );

  const typography =
    normalizeTypographyStyle(
      configuration.typographyStyle
    );

  const titleFont =
    typography ===
    "modern-sans"
      ? helveticaBold
      : typography ===
          "soft-script"
        ? timesItalic
        : timesBold;

  const bodyFont =
    typography ===
    "modern-sans"
      ? helvetica
      : timesRoman;

  const coverColor =
    parseHexColor(
      configuration.coverColorHex,
      DEFAULTS.coverColor
    );

  const accentColor =
    parseHexColor(
      configuration.accentColorHex,
      DEFAULTS.accentColor
    );

  const textColor =
    parseHexColor(
      configuration.coverTextColorHex,
      DEFAULTS.coverTextColor
    );

  const borderStyle =
    normalizeBorderStyle(
      configuration.coverBorderStyle
    );

  /*
  |--------------------------------------------------------------------------
  | Front cover
  |--------------------------------------------------------------------------
  */

  const frontPage =
    pdfDocument.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  frontPage.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: coverColor,
  });

  drawCoverBorder({
    page: frontPage,
    borderStyle,
    accentColor,
  });

  /*
   * The extra left margin protects content from the coil holes.
   */

  const safeLeft =
    27 *
    MM_TO_POINTS;

  const safeRight =
    20 *
    MM_TO_POINTS;

  const safeTop =
    22 *
    MM_TO_POINTS;

  const safeBottom =
    20 *
    MM_TO_POINTS;

  const contentWidth =
    PAGE_WIDTH -
    safeLeft -
    safeRight;

  const mark =
    initialsFromName(
      configuration.ownerName
    );

  const markRadius =
    12 *
    MM_TO_POINTS;

  const markCenterX =
    safeLeft +
    markRadius;

  const markCenterY =
    PAGE_HEIGHT -
    safeTop -
    markRadius;

  frontPage.drawCircle({
    x: markCenterX,
    y: markCenterY,
    size: markRadius,
    borderColor:
      accentColor,
    borderWidth: 1.3,
  });

  const markSize = 14;

  const markWidth =
    helveticaBold
      .widthOfTextAtSize(
        mark,
        markSize
      );

  frontPage.drawText(
    mark,
    {
      x:
        markCenterX -
        markWidth / 2,

      y:
        markCenterY -
        markSize * 0.36,

      size: markSize,

      font:
        helveticaBold,

      color:
        accentColor,
    }
  );

  const titleBlock =
    fitTextBlock({
      text:
        configuration.notebookTitle,

      font:
        titleFont,

      maxWidth:
        contentWidth *
        0.86,

      maxLines: 3,

      preferredSize:
        typography ===
        "soft-script"
          ? 55
          : 48,

      minimumSize: 25,
    });

  const titleLineHeight =
    titleBlock.size *
    1.06;

  const titleHeight =
    Math.max(
      titleLineHeight,

      titleBlock
        .lines.length *
        titleLineHeight
    );

  const titleStartY =
    PAGE_HEIGHT / 2 +
    titleHeight / 2 +
    16 * MM_TO_POINTS;

  drawTextLines({
    page:
      frontPage,

    lines:
      titleBlock.lines,

    x:
      safeLeft,

    y:
      titleStartY,

    font:
      titleFont,

    size:
      titleBlock.size,

    lineHeight:
      titleLineHeight,

    color:
      textColor,

    maxWidth:
      contentWidth *
      0.86,
  });

  const ruleY =
    titleStartY -
    titleBlock
      .lines.length *
      titleLineHeight -
    6 * MM_TO_POINTS;

  frontPage.drawLine({
    start: {
      x: safeLeft,
      y: ruleY,
    },

    end: {
      x:
        safeLeft +
        36 *
          MM_TO_POINTS,

      y: ruleY,
    },

    thickness: 2,

    color:
      accentColor,
  });

  if (
    configuration.subtitle
  ) {
    const subtitleLines =
      wrapText({
        text:
          configuration.subtitle
            .toUpperCase(),

        font:
          helveticaBold,

        size: 9,

        maxWidth:
          contentWidth *
          0.78,
      }).slice(
        0,
        3
      );

    drawTextLines({
      page:
        frontPage,

      lines:
        subtitleLines,

      x:
        safeLeft,

      y:
        ruleY -
        8 *
          MM_TO_POINTS,

      font:
        helveticaBold,

      size: 9,

      lineHeight: 13,

      color:
        textColor,

      maxWidth:
        contentWidth *
        0.78,
    });
  }

  const ownerText =
    sanitizePdfText(
      configuration.ownerName
    ).toUpperCase();

  frontPage.drawText(
    ownerText,
    {
      x:
        safeLeft,

      y:
        safeBottom,

      size: 9,

      font:
        helveticaBold,

      color:
        accentColor,

      maxWidth:
        contentWidth,
    }
  );

  /*
  |--------------------------------------------------------------------------
  | Back cover
  |--------------------------------------------------------------------------
  */

  const backPage =
    pdfDocument.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  backPage.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: coverColor,
  });

  drawCoverBorder({
    page: backPage,
    borderStyle,
    accentColor,
  });

  const backMarkRadius =
    14 *
    MM_TO_POINTS;

  const backMarkX =
    PAGE_WIDTH / 2;

  const backMarkY =
    PAGE_HEIGHT / 2 +
    10 * MM_TO_POINTS;

  backPage.drawCircle({
    x: backMarkX,
    y: backMarkY,
    size:
      backMarkRadius,
    borderColor:
      accentColor,
    borderWidth: 1.3,
  });

  const backMarkSize =
    18;

  const backMarkWidth =
    helveticaBold
      .widthOfTextAtSize(
        mark,
        backMarkSize
      );

  backPage.drawText(
    mark,
    {
      x:
        backMarkX -
        backMarkWidth / 2,

      y:
        backMarkY -
        backMarkSize *
          0.36,

      size:
        backMarkSize,

      font:
        helveticaBold,

      color:
        accentColor,
    }
  );

  if (
    configuration.footerPhrase
  ) {
    const footerLines =
      wrapText({
        text:
          configuration.footerPhrase,

        font:
          bodyFont,

        size: 11,

        maxWidth:
          contentWidth *
          0.66,
      }).slice(
        0,
        4
      );

    const footerStartY =
      backMarkY -
      backMarkRadius -
      13 *
        MM_TO_POINTS;

    drawTextLines({
      page:
        backPage,

      lines:
        footerLines,

      x:
        safeLeft +
        contentWidth *
          0.17,

      y:
        footerStartY,

      font:
        bodyFont,

      size: 11,

      lineHeight: 16,

      color:
        textColor,

      align:
        "center",

      maxWidth:
        contentWidth *
        0.66,
    });
  }

  const brandText =
    "FRESH START PAPER";

  const brandSize = 8;

  const brandWidth =
    helveticaBold
      .widthOfTextAtSize(
        brandText,
        brandSize
      );

  backPage.drawText(
    brandText,
    {
      x:
        PAGE_WIDTH /
          2 -
        brandWidth /
          2,

      y:
        safeBottom,

      size:
        brandSize,

      font:
        helveticaBold,

      color:
        accentColor,
    }
  );

  const pdfBytes =
    await pdfDocument.save({
      useObjectStreams:
        true,

      addDefaultPage:
        false,
    });

  await fs.promises.writeFile(
    outputPath,
    pdfBytes
  );
}

/*
|--------------------------------------------------------------------------
| Interior page patterns
|--------------------------------------------------------------------------
*/

function drawInteriorGrid({
  page,
  pageStyle,
  contentLeft,
  contentRight,
  contentBottom,
  contentTop,
  lineColor,
}) {
  if (
    pageStyle === "blank"
  ) {
    return;
  }

  if (
    pageStyle === "lined"
  ) {
    const spacing =
      8 *
      MM_TO_POINTS;

    for (
      let y =
        contentTop;

      y >=
      contentBottom;

      y -= spacing
    ) {
      page.drawLine({
        start: {
          x:
            contentLeft,
          y,
        },

        end: {
          x:
            contentRight,
          y,
        },

        thickness:
          0.55,

        color:
          lineColor,
      });
    }

    return;
  }

  if (
    pageStyle ===
    "graph-grid"
  ) {
    const spacing =
      7 *
      MM_TO_POINTS;

    for (
      let y =
        contentBottom;

      y <=
      contentTop;

      y += spacing
    ) {
      page.drawLine({
        start: {
          x:
            contentLeft,
          y,
        },

        end: {
          x:
            contentRight,
          y,
        },

        thickness:
          0.35,

        color:
          lineColor,
      });
    }

    for (
      let x =
        contentLeft;

      x <=
      contentRight;

      x += spacing
    ) {
      page.drawLine({
        start: {
          x,
          y:
            contentBottom,
        },

        end: {
          x,
          y:
            contentTop,
        },

        thickness:
          0.35,

        color:
          lineColor,
      });
    }

    return;
  }

  /*
   * Dot-grid background.
   */

  const dotSpacing =
    7 *
    MM_TO_POINTS;

  const dotRadius =
    0.7;

  for (
    let y =
      contentBottom;

    y <=
    contentTop;

    y += dotSpacing
  ) {
    for (
      let x =
        contentLeft;

      x <=
      contentRight;

      x += dotSpacing
    ) {
      page.drawCircle({
        x,
        y,
        size:
          dotRadius,
        color:
          lineColor,
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| Reusable interior template
|--------------------------------------------------------------------------
|
| The line/grid artwork is created once and embedded into every page.
| This keeps the 365-page PDF smaller and faster to generate.
|
*/

async function buildInteriorTemplate(
  configuration
) {
  const templateDocument =
    await PDFDocument.create();

  const page =
    templateDocument.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  const helvetica =
    await templateDocument.embedFont(
      StandardFonts.Helvetica
    );

  const helveticaBold =
    await templateDocument.embedFont(
      StandardFonts.HelveticaBold
    );

  const timesItalic =
    await templateDocument.embedFont(
      StandardFonts.TimesRomanItalic
    );

  const paperColor =
    parseHexColor(
      configuration.paperColorHex,
      DEFAULTS.paperColor
    );

  const lineColor =
    parseHexColor(
      configuration.lineColorHex,
      DEFAULTS.lineColor
    );

  const accentColor =
    parseHexColor(
      configuration.accentColorHex,
      DEFAULTS.accentColor
    );

  const textColor =
    parseHexColor(
      "#4f3d31",
      "#4f3d31"
    );

  const pageStyle =
    normalizePageStyle(
      configuration.interiorPageStyle
    );

  page.drawRectangle({
    x: 0,
    y: 0,
    width:
      PAGE_WIDTH,
    height:
      PAGE_HEIGHT,
    color:
      paperColor,
  });

  /*
   * The larger left margin protects writing from the coil binding.
   */

  const contentLeft =
    28 *
    MM_TO_POINTS;

  const contentRight =
    PAGE_WIDTH -
    18 *
      MM_TO_POINTS;

  const headerY =
    PAGE_HEIGHT -
    21 *
      MM_TO_POINTS;

  const headerRuleY =
    headerY -
    7 *
      MM_TO_POINTS;

  const promptY =
    headerRuleY -
    8 *
      MM_TO_POINTS;

  const contentTop =
    promptY -
    11 *
      MM_TO_POINTS;

  const contentBottom =
    24 *
    MM_TO_POINTS;

  const headerBlock =
    fitTextBlock({
      text:
        configuration.pageHeader,

      font:
        helveticaBold,

      maxWidth:
        (
          contentRight -
          contentLeft
        ) *
        0.68,

      maxLines: 1,

      preferredSize:
        18,

      minimumSize:
        10,
    });

  page.drawText(
    headerBlock
      .lines[0] ||
      DEFAULTS.pageHeader,
    {
      x:
        contentLeft,

      y:
        headerY,

      size:
        headerBlock.size,

      font:
        helveticaBold,

      color:
        textColor,
    }
  );

  page.drawLine({
    start: {
      x:
        contentLeft,

      y:
        headerRuleY,
    },

    end: {
      x:
        contentRight,

      y:
        headerRuleY,
    },

    thickness:
      0.8,

    color:
      lineColor,
  });

  if (
    configuration.pagePrompt
  ) {
    const promptLines =
      wrapText({
        text:
          configuration.pagePrompt,

        font:
          timesItalic,

        size: 9,

        maxWidth:
          contentRight -
          contentLeft,
      }).slice(
        0,
        2
      );

    drawTextLines({
      page,

      lines:
        promptLines,

      x:
        contentLeft,

      y:
        promptY,

      font:
        timesItalic,

      size: 9,

      lineHeight:
        12,

      color:
        accentColor,

      maxWidth:
        contentRight -
        contentLeft,
    });
  }

  drawInteriorGrid({
    page,
    pageStyle,
    contentLeft,
    contentRight,
    contentBottom,
    contentTop,
    lineColor,
  });

  if (
    configuration.footerPhrase
  ) {
    const footerWidth =
      (
        contentRight -
        contentLeft
      ) *
      0.76;

    const footerLines =
      wrapText({
        text:
          configuration.footerPhrase,

        font:
          timesItalic,

        size: 8,

        maxWidth:
          footerWidth,
      }).slice(
        0,
        2
      );

    drawTextLines({
      page,

      lines:
        footerLines,

      x:
        contentLeft +
        (
          contentRight -
          contentLeft
        ) *
          0.12,

      y:
        13 *
        MM_TO_POINTS,

      font:
        timesItalic,

      size: 8,

      lineHeight:
        10,

      color:
        accentColor,

      align:
        "center",

      maxWidth:
        footerWidth,
    });
  }

  return templateDocument.save({
    useObjectStreams:
      true,

    addDefaultPage:
      false,
  });
}

/*
|--------------------------------------------------------------------------
| 365-page interior PDF
|--------------------------------------------------------------------------
*/

async function createInteriorPDF({
  outputPath,
  configuration,
}) {
  const pdfDocument =
    await PDFDocument.create();

  pdfDocument.setTitle(
    `${configuration.notebookTitle} - interior`
  );

  pdfDocument.setAuthor(
    "Fresh Start Paper"
  );

  pdfDocument.setSubject(
    "365-page A3 landscape coil-bound notebook interior"
  );

  pdfDocument.setProducer(
    "Fresh Start Paper API"
  );

  pdfDocument.setCreator(
    "Fresh Start Paper API"
  );

  const pageNumberFont =
    await pdfDocument.embedFont(
      StandardFonts.HelveticaBold
    );

  const templateBytes =
    await buildInteriorTemplate(
      configuration
    );

  const [
    embeddedTemplate,
  ] =
    await pdfDocument.embedPdf(
      templateBytes,
      [0]
    );

  const accentColor =
    parseHexColor(
      configuration.accentColorHex,
      DEFAULTS.accentColor
    );

  for (
    let pageNumber = 1;

    pageNumber <=
    NOTEBOOK_TOTAL_PAGES;

    pageNumber += 1
  ) {
    const page =
      pdfDocument.addPage([
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ]);

    page.drawPage(
      embeddedTemplate,
      {
        x: 0,
        y: 0,
        width:
          PAGE_WIDTH,
        height:
          PAGE_HEIGHT,
      }
    );

    const pageNumberText =
      formatPageNumber(
        pageNumber,
        configuration.pageNumberStyle
      );

    if (
      pageNumberText
    ) {
      const numberSize =
        8;

      const numberWidth =
        pageNumberFont
          .widthOfTextAtSize(
            pageNumberText,
            numberSize
          );

      page.drawText(
        pageNumberText,
        {
          x:
            PAGE_WIDTH -
            18 *
              MM_TO_POINTS -
            numberWidth,

          y:
            PAGE_HEIGHT -
            21 *
              MM_TO_POINTS,

          size:
            numberSize,

          font:
            pageNumberFont,

          color:
            accentColor,
        }
      );
    }
  }

  const pdfBytes =
    await pdfDocument.save({
      useObjectStreams:
        true,

      addDefaultPage:
        false,
    });

  await fs.promises.writeFile(
    outputPath,
    pdfBytes
  );
}

/*
|--------------------------------------------------------------------------
| Public generator
|--------------------------------------------------------------------------
*/

async function generateNotebookPDFs(
  order,
  lineItem
) {
  if (
    !order ||
    typeof order !==
      "object"
  ) {
    throw new Error(
      "A Shopify order is required to generate notebook PDFs"
    );
  }

  if (
    !lineItem ||
    typeof lineItem !==
      "object"
  ) {
    throw new Error(
      "A Shopify line item is required to generate notebook PDFs"
    );
  }

  const outputDirectory =
    path.join(
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
    order.name ||
    order.id ||
    Date.now();

  const safeOrderNumber =
    safeFilePart(
      orderNumber,
      "unknown-order"
    );

  const safeItemId =
    safeFilePart(
      lineItem.id,
      "unknown-item"
    );

  const interiorPath =
    path.join(
      outputDirectory,

      `order-${safeOrderNumber}-item-${safeItemId}-notebook-interior.pdf`
    );

  const coverPath =
    path.join(
      outputDirectory,

      `order-${safeOrderNumber}-item-${safeItemId}-notebook-cover.pdf`
    );

  const configuration =
    createNotebookConfiguration(
      lineItem
    );

  /*
   * Page count is intentionally locked to 365.
   * A manipulated Shopify page-count property cannot change production.
   */

  await createInteriorPDF({
    outputPath:
      interiorPath,

    configuration,
  });

  await createCoverPDF({
    outputPath:
      coverPath,

    configuration,
  });

  return {
    interiorPath,
    coverPath,

    itemId:
      lineItem.id,

    orderId:
      order.id,

    orderNumber,

    totalPages:
      NOTEBOOK_TOTAL_PAGES,

    coverPages:
      COVER_TOTAL_PAGES,

    dimensions: {
      trimMm: {
        width:
          TRIM_WIDTH_MM,

        height:
          TRIM_HEIGHT_MM,
      },

      bleedMm:
        BLEED_MM,

      pdfMm: {
        width:
          PDF_WIDTH_MM,

        height:
          PDF_HEIGHT_MM,
      },

      pdfPoints: {
        width:
          PAGE_WIDTH,

        height:
          PAGE_HEIGHT,
      },
    },

    configuration: {
      ...configuration,

      totalPages:
        NOTEBOOK_TOTAL_PAGES,

      productReference:
        "textbook_co_a3_l_fc_ink",

      cloudprinterFiles: {
        interior:
          "book",

        cover:
          "cover",
      },
    },
  };
}

module.exports = {
  generateNotebookPDFs,

  NOTEBOOK_TOTAL_PAGES,
  COVER_TOTAL_PAGES,

  TRIM_WIDTH_MM,
  TRIM_HEIGHT_MM,
  BLEED_MM,

  PDF_WIDTH_MM,
  PDF_HEIGHT_MM,
};