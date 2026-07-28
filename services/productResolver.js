const JOURNAL_TOTAL_PAGES = 366;
const CALENDAR_TOTAL_PAGES = 13;

/**
 * Convert an unknown value to a trimmed string.
 */
function clean(value) {
  return String(value ?? "").trim();
}

/**
 * Normalize values for safe comparisons.
 */
function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return all configured calendar SKUs.
 */
function getCalendarSkus() {
  return clean(process.env.CALENDAR_SHOPIFY_SKUS)
    .split(",")
    .map(normalize)
    .filter(Boolean);
}

/**
 * Build searchable product text from Shopify line-item data.
 */
function getLineItemSearchText(lineItem) {
  const properties = Array.isArray(lineItem?.properties)
    ? lineItem.properties
    : [];

  return [
    lineItem?.sku,
    lineItem?.title,
    lineItem?.name,
    lineItem?.variant_title,
    lineItem?.vendor,
    ...properties.flatMap((property) => [
      property?.name,
      property?.value,
    ]),
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

/**
 * Determine whether a Shopify line item is the calendar product.
 *
 * The exact Shopify calendar SKU is:
 * CUSTOM-CALENDAR
 */
function isCalendarLineItem(lineItem) {
  const configuredSkus = getCalendarSkus();
  const itemSku = normalize(lineItem?.sku);

  if (itemSku && configuredSkus.includes(itemSku)) {
    return true;
  }

  /*
   * This secondary check is useful for local testing, but the SKU remains
   * the strongest and safest production identifier.
   */
  const searchText = getLineItemSearchText(lineItem);

  return /(^|-)calendar($|-)/.test(searchText);
}

/**
 * Return the exact Cloudprinter configuration for the calendar.
 *
 * Confirmed using Cloudprinter product information:
 *
 * Product:
 * calendar_wall_int_a5_l_double_fc_tnr
 *
 * Required file:
 * type = product
 * format = pdf
 *
 * Required options:
 * paper_170mcg
 * calendar_13_pages
 */
function getCalendarProductConfiguration() {
  return {
    kind: "calendar",
    label: "A5 landscape wall calendar",
    totalPages: CALENDAR_TOTAL_PAGES,

    productReference: clean(
      process.env.CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE ||
        "calendar_wall_int_a5_l_double_fc_tnr"
    ),

    shippingLevel: clean(
      process.env.CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL ||
        "cp_ground"
    ),

    options: [
      {
        type: "paper_170mcg",
        count: "1",
      },
      {
        type: "calendar_13_pages",
        count: "1",
      },
    ],

    requiredFiles: [
      {
        sourceKey: "product",
        cloudprinterType: "product",
      },
    ],
  };
}

/**
 * Preserve the existing working journal configuration.
 */
function getJournalProductConfiguration() {
  return {
    kind: "journal",
    label: "Personalized journal",
    totalPages: JOURNAL_TOTAL_PAGES,

    productReference: clean(
      process.env.CLOUDPRINTER_PRODUCT_REFERENCE ||
        "textbook_pb_1025x6630_l_fc_ink"
    ),

    shippingLevel: clean(
      process.env.CLOUDPRINTER_SHIPPING_LEVEL ||
        "cp_ground"
    ),

    options: [
      {
        type: "total_pages",
        count: String(JOURNAL_TOTAL_PAGES),
      },
      {
        type: clean(
          process.env.CLOUDPRINTER_MAIN_PAPER ||
            "pageblock_80off"
        ),
        count: String(JOURNAL_TOTAL_PAGES),
      },
      {
        type: clean(
          process.env.CLOUDPRINTER_COVER_PAPER ||
            "cover_250ecb"
        ),
        count: "1",
      },
      {
        type: clean(
          process.env.CLOUDPRINTER_COVER_FINISH ||
            "cover_finish_gloss"
        ),
        count: "1",
      },
    ],

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
  };
}

/**
 * Resolve the correct product workflow.
 */
function resolveProduct(lineItem) {
  if (isCalendarLineItem(lineItem)) {
    return getCalendarProductConfiguration();
  }

  return getJournalProductConfiguration();
}

module.exports = {
  CALENDAR_TOTAL_PAGES,
  JOURNAL_TOTAL_PAGES,
  getCalendarProductConfiguration,
  getJournalProductConfiguration,
  isCalendarLineItem,
  resolveProduct,
};