const JOURNAL_TOTAL_PAGES = 366;
const CALENDAR_TOTAL_PAGES = 13;

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitEnvironmentList(name) {
  return clean(process.env[name])
    .split(",")
    .map((value) => normalize(value))
    .filter(Boolean);
}

function normalizeId(value) {
  return clean(value).replace(/[^0-9]/g, "");
}

function splitIdEnvironmentList(name) {
  return clean(process.env[name])
    .split(",")
    .map(normalizeId)
    .filter(Boolean);
}

function getProperties(lineItem) {
  return Array.isArray(lineItem?.properties) ? lineItem.properties : [];
}

function getLineItemSearchText(lineItem) {
  return [
    lineItem?.sku,
    lineItem?.title,
    lineItem?.name,
    lineItem?.variant_title,
    lineItem?.vendor,
    lineItem?.product_type,
    ...getProperties(lineItem).flatMap((property) => [
      property?.name,
      property?.value,
    ]),
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function propertyLooksLikeCalendar(property) {
  const propertyName = normalize(property?.name);
  const propertyValue = normalize(property?.value);

  const explicitCalendarPropertyNames = [
    "calendar-year",
    "calendar-title",
    "calendar-start-date",
    "calendar-start-month",
    "calendar-style",
    "calendar-layout",
    "calendar-type",
    "calendar-product",
    "calendar-product-type",
    "calendar-notes-label",
    "start-month",
    "month-start",
  ];

  if (explicitCalendarPropertyNames.includes(propertyName)) {
    return true;
  }

  if (
    ["product-kind", "product-type", "item-type", "template-type", "_product-kind", "_product-type"]
      .includes(propertyName) &&
    /(^|-)calendar(s)?($|-)/.test(propertyValue)
  ) {
    return true;
  }

  return /(^|-)calendar(s)?($|-)/.test(propertyName);
}

function getProductDetection(lineItem) {
  const reasons = [];
  const configuredSkus = splitEnvironmentList("CALENDAR_SHOPIFY_SKUS");
  const configuredProductIds = splitIdEnvironmentList("CALENDAR_SHOPIFY_PRODUCT_IDS");
  const configuredVariantIds = splitIdEnvironmentList("CALENDAR_SHOPIFY_VARIANT_IDS");
  const configuredKeywords = [
    ...splitEnvironmentList("CALENDAR_PRODUCT_KEYWORDS"),
    "calendar",
    "wall-calendar",
  ];

  const sku = normalize(lineItem?.sku);
  const productId = normalizeId(lineItem?.product_id);
  const variantId = normalizeId(lineItem?.variant_id);
  const searchText = getLineItemSearchText(lineItem);
  const properties = getProperties(lineItem);

  if (sku && configuredSkus.includes(sku)) {
    reasons.push(`SKU matched CALENDAR_SHOPIFY_SKUS (${lineItem.sku})`);
  }

  if (productId && configuredProductIds.includes(productId)) {
    reasons.push(`product_id matched CALENDAR_SHOPIFY_PRODUCT_IDS (${productId})`);
  }

  if (variantId && configuredVariantIds.includes(variantId)) {
    reasons.push(`variant_id matched CALENDAR_SHOPIFY_VARIANT_IDS (${variantId})`);
  }

  for (const keyword of configuredKeywords) {
    if (keyword && searchText.split(/\s+/).some((token) => token === keyword || token.includes(keyword))) {
      reasons.push(`line-item text matched calendar keyword (${keyword})`);
      break;
    }
  }

  const calendarProperty = properties.find(propertyLooksLikeCalendar);
  if (calendarProperty) {
    reasons.push(`calendar customization property found (${clean(calendarProperty.name)})`);
  }

  return {
    kind: reasons.length ? "calendar" : "journal",
    reasons: reasons.length ? reasons : ["No calendar signal found; using journal workflow"],
    inspected: {
      sku: clean(lineItem?.sku),
      productId: clean(lineItem?.product_id),
      variantId: clean(lineItem?.variant_id),
      title: clean(lineItem?.title),
      variantTitle: clean(lineItem?.variant_title),
      propertyNames: properties.map((property) => clean(property?.name)).filter(Boolean),
    },
  };
}

function isCalendarLineItem(lineItem) {
  return getProductDetection(lineItem).kind === "calendar";
}

function parseOptionsJson(environmentName, fallback) {
  const raw = clean(process.env[environmentName]);

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("must be a JSON array");
    }

    return parsed
      .map((option) => ({
        type: clean(option?.type),
        count: clean(option?.count || "1"),
      }))
      .filter((option) => option.type);
  } catch (error) {
    throw new Error(`${environmentName} is invalid: ${error.message}`);
  }
}

function resolveProduct(lineItem) {
  const detection = getProductDetection(lineItem);

  if (detection.kind === "calendar") {
    const productReference = clean(
      process.env.CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE ||
        "calendar_wall_int_a5_l_double_fc_tnr"
    );

    return {
      kind: "calendar",
      label: "A5 landscape wall calendar",
      totalPages: CALENDAR_TOTAL_PAGES,
      productReference,
      shippingLevel: clean(
        process.env.CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL ||
          process.env.CLOUDPRINTER_SHIPPING_LEVEL ||
          "cp_ground"
      ),
      options: parseOptionsJson(
        "CLOUDPRINTER_CALENDAR_OPTIONS_JSON",
        [{ type: "total_pages", count: String(CALENDAR_TOTAL_PAGES) }]
      ),
      requiredFiles: [{ sourceKey: "product", cloudprinterType: "book" }],
      detection,
    };
  }

  return {
    kind: "journal",
    label: "Personalized journal",
    totalPages: JOURNAL_TOTAL_PAGES,
    productReference: clean(
      process.env.CLOUDPRINTER_PRODUCT_REFERENCE ||
        "textbook_pb_1025x6630_l_fc_ink"
    ),
    shippingLevel: clean(process.env.CLOUDPRINTER_SHIPPING_LEVEL || "cp_ground"),
    options: [
      { type: "total_pages", count: String(JOURNAL_TOTAL_PAGES) },
      {
        type: clean(process.env.CLOUDPRINTER_MAIN_PAPER || "pageblock_80off"),
        count: String(JOURNAL_TOTAL_PAGES),
      },
      {
        type: clean(process.env.CLOUDPRINTER_COVER_PAPER || "cover_250ecb"),
        count: "1",
      },
      {
        type: clean(process.env.CLOUDPRINTER_COVER_FINISH || "cover_finish_gloss"),
        count: "1",
      },
    ],
    requiredFiles: [
      { sourceKey: "interior", cloudprinterType: "book" },
      { sourceKey: "cover", cloudprinterType: "cover" },
    ],
    detection,
  };
}

module.exports = {
  CALENDAR_TOTAL_PAGES,
  JOURNAL_TOTAL_PAGES,
  getProductDetection,
  isCalendarLineItem,
  resolveProduct,
};
