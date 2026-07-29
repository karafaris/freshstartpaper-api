const DEFAULT_SHIPPING_LEVEL = "cp_postal";

const JOURNAL_TOTAL_PAGES = 366;
const CALENDAR_TOTAL_PAGES = 13;
const NOTEBOOK_TOTAL_PAGES = 365;

function clean(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function env(name, fallback = "") {
  return clean(process.env[name], fallback);
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Convert Shopify line-item properties into an object with
 * normalized property names.
 *
 * Example:
 *
 * "Notebook title" becomes:
 * properties.notebooktitle
 */
function propertiesToObject(lineItem) {
  const result = {};
  const properties = lineItem?.properties;

  if (Array.isArray(properties)) {
    for (const property of properties) {
      if (!property?.name) {
        continue;
      }

      result[normalizeKey(property.name)] = clean(
        property.value
      );
    }

    return result;
  }

  if (
    properties &&
    typeof properties === "object"
  ) {
    for (const [name, value] of Object.entries(
      properties
    )) {
      result[normalizeKey(name)] = clean(value);
    }
  }

  return result;
}

/**
 * Create searchable text from the Shopify product information
 * and every saved customization property.
 */
function createSearchText(
  lineItem,
  properties
) {
  const propertyText = Object.entries(
    properties
  )
    .flatMap(([name, value]) => [
      name,
      value,
    ])
    .join(" ");

  return [
    lineItem?.title,
    lineItem?.name,
    lineItem?.sku,
    lineItem?.variant_title,
    lineItem?.vendor,
    propertyText,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Build Cloudprinter options for products that use:
 *
 * 1. An interior/book PDF
 * 2. A separate cover PDF
 */
function makeBookOptions({
  totalPages,
  mainPaper,
  coverPaper,
  coverFinish,
}) {
  return [
    {
      type: "total_pages",
      count: String(totalPages),
    },
    {
      type: mainPaper,
      count: String(totalPages),
    },
    {
      type: coverPaper,
      count: "1",
    },
    {
      type: coverFinish,
      count: "1",
    },
  ];
}

/**
 * Existing custom journal configuration.
 */
function createJournalConfiguration() {
  const totalPages = JOURNAL_TOTAL_PAGES;

  return {
    kind: "journal",

    productReference: env(
      "CLOUDPRINTER_JOURNAL_PRODUCT_REFERENCE",
      env(
        "CLOUDPRINTER_PRODUCT_REFERENCE",
        "textbook_pb_1025x6630_l_fc_ink"
      )
    ),

    shippingLevel: env(
      "CLOUDPRINTER_JOURNAL_SHIPPING_LEVEL",
      env(
        "CLOUDPRINTER_SHIPPING_LEVEL",
        DEFAULT_SHIPPING_LEVEL
      )
    ),

    totalPages,

    requiredFiles: [
      {
        sourceKey: "interior",
        cloudprinterType: "book",
      },
      {
        sourceKey: "cover",
        cloudprinterType: "cover",
      },
    ],

    options: makeBookOptions({
      totalPages,

      mainPaper: env(
        "CLOUDPRINTER_JOURNAL_MAIN_PAPER",
        env(
          "CLOUDPRINTER_MAIN_PAPER",
          "pageblock_80off"
        )
      ),

      coverPaper: env(
        "CLOUDPRINTER_JOURNAL_COVER_PAPER",
        env(
          "CLOUDPRINTER_COVER_PAPER",
          "cover_250ecb"
        )
      ),

      coverFinish: env(
        "CLOUDPRINTER_JOURNAL_COVER_FINISH",
        env(
          "CLOUDPRINTER_COVER_FINISH",
          "cover_finish_gloss"
        )
      ),
    }),
  };
}

/**
 * Existing A5 landscape wall-calendar configuration.
 *
 * The generated calendar has:
 * - 1 cover/title page
 * - 12 monthly pages
 * - 13 total pages
 */
function createCalendarConfiguration() {
  const totalPages = CALENDAR_TOTAL_PAGES;

  return {
    kind: "calendar",

    productReference: env(
      "CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE",
      "calendar_wall_int_a5_l_double_fc_tnr"
    ),

    shippingLevel: env(
      "CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL",
      env(
        "CLOUDPRINTER_SHIPPING_LEVEL",
        DEFAULT_SHIPPING_LEVEL
      )
    ),

    totalPages,

    requiredFiles: [
      {
        sourceKey: "product",
        cloudprinterType: "product",
      },
    ],

    options: [
      {
        type: "total_pages",
        count: String(totalPages),
      },
    ],
  };
}

/**
 * New A3 landscape coil-bound notebook configuration.
 *
 * Production settings are intentionally locked:
 *
 * - Product: Textbook Coil Binding A3 Landscape FC Inkjet
 * - Product reference: textbook_co_a3_l_fc_ink
 * - Interior pages: 365
 * - Interior Cloudprinter file type: book
 * - Cover Cloudprinter file type: cover
 */
function createNotebookConfiguration() {
  const totalPages = NOTEBOOK_TOTAL_PAGES;

  return {
    kind: "notebook",

    productReference: env(
      "CLOUDPRINTER_NOTEBOOK_PRODUCT_REFERENCE",
      "textbook_co_a3_l_fc_ink"
    ),

    shippingLevel: env(
      "CLOUDPRINTER_NOTEBOOK_SHIPPING_LEVEL",
      env(
        "CLOUDPRINTER_SHIPPING_LEVEL",
        DEFAULT_SHIPPING_LEVEL
      )
    ),

    totalPages,

    requiredFiles: [
      {
        sourceKey: "interior",
        cloudprinterType: "book",
      },
      {
        sourceKey: "cover",
        cloudprinterType: "cover",
      },
    ],

    options: makeBookOptions({
      totalPages,

      mainPaper: env(
        "CLOUDPRINTER_NOTEBOOK_MAIN_PAPER",
        env(
          "CLOUDPRINTER_MAIN_PAPER",
          "pageblock_80off"
        )
      ),

      coverPaper: env(
        "CLOUDPRINTER_NOTEBOOK_COVER_PAPER",
        env(
          "CLOUDPRINTER_COVER_PAPER",
          "cover_250ecb"
        )
      ),

      coverFinish: env(
        "CLOUDPRINTER_NOTEBOOK_COVER_FINISH",
        env(
          "CLOUDPRINTER_COVER_FINISH",
          "cover_finish_gloss"
        )
      ),
    }),
  };
}

/**
 * Identify a notebook using strong notebook-specific markers.
 *
 * Detection works when any of these are present:
 *
 * - Shopify property: Notebook title
 * - Customization version contains "notebook"
 * - Exact Cloudprinter product reference
 * - Product title, variant or SKU contains "notebook"
 */
function isNotebook(
  lineItem,
  properties,
  searchText
) {
  return Boolean(
    properties.notebooktitle ||
      properties.customizationversion
        ?.toLowerCase()
        .includes("notebook") ||
      searchText.includes(
        "textbook_co_a3_l_fc_ink"
      ) ||
      searchText.includes(
        "textbook co a3 l fc ink"
      ) ||
      /\bnotebook\b/.test(searchText)
  );
}

/**
 * Identify a calendar using calendar-specific properties,
 * its product reference, title, variant or SKU.
 */
function isCalendar(
  lineItem,
  properties,
  searchText
) {
  return Boolean(
    properties.calendartitle ||
      properties.calendarstartingmonth ||
      properties.calendarlength ||
      properties.customizationversion
        ?.toLowerCase()
        .includes("calendar") ||
      searchText.includes(
        "calendar_wall_int_a5_l_double_fc_tnr"
      ) ||
      /\bcalendar\b/.test(searchText)
  );
}

/**
 * Resolve the correct generator and Cloudprinter configuration.
 *
 * Notebook is checked first so it cannot accidentally fall through
 * to the journal generator.
 */
function resolveProduct(lineItem) {
  if (!lineItem) {
    throw new Error(
      "A Shopify line item is required to resolve a product"
    );
  }

  const properties =
    propertiesToObject(lineItem);

  const searchText =
    createSearchText(
      lineItem,
      properties
    );

  if (
    isNotebook(
      lineItem,
      properties,
      searchText
    )
  ) {
    return createNotebookConfiguration();
  }

  if (
    isCalendar(
      lineItem,
      properties,
      searchText
    )
  ) {
    return createCalendarConfiguration();
  }

  /*
   * Journal remains the fallback so the existing journal
   * workflow continues working exactly as it does now.
   */
  return createJournalConfiguration();
}

module.exports = {
  resolveProduct,
  propertiesToObject,
  JOURNAL_TOTAL_PAGES,
  CALENDAR_TOTAL_PAGES,
  NOTEBOOK_TOTAL_PAGES,
};