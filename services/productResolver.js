const JOURNAL_TOTAL_PAGES = 366;
const CALENDAR_TOTAL_PAGES = 13;
const CALENDAR_SKU = "CUSTOM-CALENDAR";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSku(value) {
  return clean(value).toUpperCase();
}

function isCalendarLineItem(lineItem) {
  return (
    normalizeSku(lineItem?.sku) ===
    CALENDAR_SKU
  );
}

function getCalendarProductConfiguration() {
  return {
    kind:
      "calendar",

    sku:
      CALENDAR_SKU,

    label:
      "A5 landscape wall calendar",

    totalPages:
      CALENDAR_TOTAL_PAGES,

    productReference:
      clean(
        process.env
          .CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE
      ) ||
      "calendar_wall_int_a5_l_double_fc_tnr",

    shippingLevel:
      clean(
        process.env
          .CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL
      ) ||
      "cp_ground",

    options: [
      {
        type:
          clean(
            process.env
              .CLOUDPRINTER_CALENDAR_PAPER
          ) ||
          "paper_170mcg",
        count:
          "1",
      },
      {
        type:
          clean(
            process.env
              .CLOUDPRINTER_CALENDAR_PAGE_OPTION
          ) ||
          "calendar_13_pages",
        count:
          "1",
      },
    ],

    requiredFiles: [
      {
        sourceKey:
          "product",
        cloudprinterType:
          "product",
      },
    ],
  };
}

function getJournalProductConfiguration() {
  return {
    kind:
      "journal",

    totalPages:
      JOURNAL_TOTAL_PAGES,

    productReference:
      clean(
        process.env
          .CLOUDPRINTER_PRODUCT_REFERENCE
      ) ||
      "textbook_pb_1025x6630_l_fc_ink",

    shippingLevel:
      clean(
        process.env
          .CLOUDPRINTER_SHIPPING_LEVEL
      ) ||
      "cp_ground",

    requiredFiles: [
      {
        sourceKey:
          "interior",
        cloudprinterType:
          "book",
      },
      {
        sourceKey:
          "cover",
        cloudprinterType:
          "cover",
      },
    ],
  };
}

function resolveProduct(lineItem) {
  return isCalendarLineItem(
    lineItem
  )
    ? getCalendarProductConfiguration()
    : getJournalProductConfiguration();
}

module.exports = {
  CALENDAR_SKU,
  CALENDAR_TOTAL_PAGES,
  JOURNAL_TOTAL_PAGES,
  isCalendarLineItem,
  getCalendarProductConfiguration,
  getJournalProductConfiguration,
  resolveProduct,
};