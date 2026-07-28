const axios = require("axios");

const CLOUDPRINTER_ORDERS_ADD_URL =
  "https://api.cloudprinter.com/cloudcore/1.0/orders/add";

const DEFAULT_JOURNAL_PRODUCT_REFERENCE =
  "textbook_pb_1025x6630_l_fc_ink";

const DEFAULT_JOURNAL_SHIPPING_LEVEL =
  "cp_ground";

const DEFAULT_JOURNAL_MAIN_PAPER =
  "pageblock_80off";

const DEFAULT_JOURNAL_COVER_PAPER =
  "cover_250ecb";

const DEFAULT_JOURNAL_COVER_FINISH =
  "cover_finish_gloss";

const DEFAULT_JOURNAL_TOTAL_PAGES = 366;

const DEFAULT_CALENDAR_PRODUCT_REFERENCE =
  "calendar_wall_int_a5_l_double_fc_tnr";

const DEFAULT_CALENDAR_SHIPPING_LEVEL =
  "cp_ground";

const DEFAULT_CALENDAR_TOTAL_PAGES = 13;

const DEFAULT_CALENDAR_PAPER =
  "paper_170mcg";

const DEFAULT_CALENDAR_PAGE_OPTION =
  "calendar_13_pages";

/**
 * Return a required environment variable.
 */
function requireEnvironmentVariable(name) {
  const value = String(
    process.env[name] || ""
  ).trim();

  if (!value) {
    throw new Error(
      `${name} is not configured`
    );
  }

  return value;
}

/**
 * Return an optional environment variable or fallback.
 */
function getEnvironmentVariable(
  name,
  fallback = ""
) {
  const value = String(
    process.env[name] || ""
  ).trim();

  return value || fallback;
}

/**
 * Convert an unknown value into a clean string.
 */
function cleanString(
  value,
  fallback = ""
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const cleaned = String(value).trim();

  return cleaned || fallback;
}

/**
 * Return the first non-empty value.
 */
function firstAvailable(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

/**
 * Create safe Cloudprinter references.
 */
function sanitizeReference(
  value,
  fallback
) {
  const sanitized = cleanString(
    value,
    fallback
  )
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

/**
 * Convert Shopify country data to an ISO country code.
 */
function normalizeCountryCode(address) {
  const directCountryCode =
    cleanString(
      address?.country_code
    ).toUpperCase();

  if (
    /^[A-Z]{2}$/.test(
      directCountryCode
    )
  ) {
    return directCountryCode;
  }

  const countryName =
    cleanString(
      address?.country
    ).toLowerCase();

  const knownCountries = {
    "united states": "US",
    "united states of america":
      "US",
    usa: "US",
    canada: "CA",
    mexico: "MX",
    "united kingdom": "GB",
    england: "GB",
    scotland: "GB",
    wales: "GB",
    ireland: "IE",
    australia: "AU",
    "new zealand": "NZ",
    germany: "DE",
    france: "FR",
    italy: "IT",
    spain: "ES",
    netherlands: "NL",
    belgium: "BE",
  };

  return (
    knownCountries[countryName] ||
    ""
  );
}

/**
 * Normalize a state or province code.
 */
function normalizeStateCode(address) {
  const stateCode =
    firstAvailable(
      address?.province_code,
      address?.state_code
    ).toUpperCase();

  if (/^[A-Z]{2}$/.test(stateCode)) {
    return stateCode;
  }

  return cleanString(
    address?.province ||
      address?.state
  );
}

/**
 * Return the Shopify delivery address.
 */
function getShopifyDeliveryAddress(order) {
  return (
    order?.shipping_address ||
    order?.billing_address ||
    null
  );
}

/**
 * Build Cloudprinter's delivery-address object.
 */
function buildDeliveryAddress(order) {
  const sourceAddress =
    getShopifyDeliveryAddress(order);

  if (!sourceAddress) {
    throw new Error(
      "The Shopify order does not contain a shipping or billing address"
    );
  }

  const firstName =
    firstAvailable(
      sourceAddress.first_name,
      order?.customer?.first_name,
      "Customer"
    );

  const lastName =
    firstAvailable(
      sourceAddress.last_name,
      order?.customer?.last_name,
      "Customer"
    );

  const street1 =
    firstAvailable(
      sourceAddress.address1
    );

  const street2 =
    firstAvailable(
      sourceAddress.address2
    );

  const zip =
    firstAvailable(
      sourceAddress.zip,
      sourceAddress.postal_code
    );

  const city =
    firstAvailable(
      sourceAddress.city
    );

  const country =
    normalizeCountryCode(
      sourceAddress
    );

  const state =
    normalizeStateCode(
      sourceAddress
    );

  const customerEmail =
    firstAvailable(
      order?.email,
      order?.contact_email,
      order?.customer?.email,
      process.env
        .CLOUDPRINTER_SUPPORT_EMAIL
    );

  const customerPhone =
    firstAvailable(
      sourceAddress.phone,
      order?.phone,
      order?.customer?.phone,
      process.env
        .CLOUDPRINTER_SUPPORT_PHONE
    );

  const missingFields = [];

  if (!firstName) {
    missingFields.push("firstname");
  }

  if (!lastName) {
    missingFields.push("lastname");
  }

  if (!street1) {
    missingFields.push("street1");
  }

  if (!zip) {
    missingFields.push("zip");
  }

  if (!city) {
    missingFields.push("city");
  }

  if (!country) {
    missingFields.push(
      "country ISO code"
    );
  }

  if (!customerEmail) {
    missingFields.push("email");
  }

  if (!customerPhone) {
    missingFields.push("phone");
  }

  if (
    ["US", "CA"].includes(country) &&
    !state
  ) {
    missingFields.push(
      "state/province code"
    );
  }

  if (missingFields.length > 0) {
    throw new Error(
      `The delivery address is missing required Cloudprinter fields: ${missingFields.join(
        ", "
      )}`
    );
  }

  const deliveryAddress = {
    type: "delivery",
    company: cleanString(
      sourceAddress.company
    ),
    firstname: firstName,
    lastname: lastName,
    street1,
    zip,
    city,
    country,
    email: customerEmail,
    phone: customerPhone,
  };

  if (street2) {
    deliveryAddress.street2 =
      street2;
  }

  if (state) {
    deliveryAddress.state = state;
  }

  return deliveryAddress;
}

/**
 * Validate and normalize one uploaded file.
 */
function normalizeUploadedFile({
  file,
  expectedType,
  cloudprinterType,
}) {
  if (!file) {
    throw new Error(
      `The uploaded ${expectedType} PDF is missing`
    );
  }

  const url = firstAvailable(
    file.url,
    file.secureUrl,
    file.secure_url
  );

  const md5sum =
    cleanString(file.md5sum);

  if (!url) {
    throw new Error(
      `The uploaded ${expectedType} PDF does not have a URL`
    );
  }

  if (
    !url.toLowerCase().startsWith(
      "https://"
    )
  ) {
    throw new Error(
      `The uploaded ${expectedType} PDF URL must use HTTPS`
    );
  }

  if (
    !/^[a-f0-9]{32}$/i.test(md5sum)
  ) {
    throw new Error(
      `The uploaded ${expectedType} PDF does not have a valid MD5 checksum`
    );
  }

  return {
    type: cloudprinterType,
    url,
    md5sum,
  };
}

/**
 * Build journal files.
 *
 * Cloudprinter expects:
 * - book
 * - cover
 */
function buildJournalFiles(
  uploadedFiles
) {
  return [
    normalizeUploadedFile({
      file:
        uploadedFiles?.interior,
      expectedType: "interior",
      cloudprinterType: "book",
    }),

    normalizeUploadedFile({
      file:
        uploadedFiles?.cover,
      expectedType: "cover",
      cloudprinterType: "cover",
    }),
  ];
}

/**
 * Build calendar files.
 *
 * Cloudprinter expects one PDF:
 * - product
 */
function buildCalendarFiles(
  uploadedFiles
) {
  return [
    normalizeUploadedFile({
      file:
        uploadedFiles?.product,
      expectedType: "calendar product",
      cloudprinterType:
        "product",
    }),
  ];
}

/**
 * Build the existing journal options.
 */
function buildJournalOptions(
  totalPages
) {
  const normalizedTotalPages =
    Number(totalPages);

  if (
    !Number.isInteger(
      normalizedTotalPages
    ) ||
    normalizedTotalPages <= 0
  ) {
    throw new Error(
      "Journal totalPages must be a positive whole number"
    );
  }

  const mainPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_MAIN_PAPER",
      DEFAULT_JOURNAL_MAIN_PAPER
    );

  const coverPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_PAPER",
      DEFAULT_JOURNAL_COVER_PAPER
    );

  const coverFinish =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_FINISH",
      DEFAULT_JOURNAL_COVER_FINISH
    );

  return [
    {
      type: "total_pages",
      count: String(
        normalizedTotalPages
      ),
    },
    {
      type: mainPaper,
      count: String(
        normalizedTotalPages
      ),
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
 * Build the confirmed calendar options.
 *
 * Confirmed from Cloudprinter product information:
 * - paper_170mcg
 * - calendar_13_pages
 */
function buildCalendarOptions() {
  const calendarPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_CALENDAR_PAPER",
      DEFAULT_CALENDAR_PAPER
    );

  const calendarPageOption =
    getEnvironmentVariable(
      "CLOUDPRINTER_CALENDAR_PAGE_OPTION",
      DEFAULT_CALENDAR_PAGE_OPTION
    );

  return [
    {
      type: calendarPaper,
      count: "1",
    },
    {
      type: calendarPageOption,
      count: "1",
    },
  ];
}

/**
 * Create a unique Cloudprinter order reference.
 */
function buildCloudprinterOrderReference({
  orderId,
  orderNumber,
  itemId,
  productKind,
}) {
  const baseReference =
    sanitizeReference(
      `fsp-${productKind}-${orderNumber}-${orderId}-${itemId}`,
      `fsp-${productKind}-${Date.now()}`
    );

  const timestampSuffix =
    Date.now().toString(36);

  return sanitizeReference(
    `${baseReference}-${timestampSuffix}`,
    `fsp-${productKind}-${Date.now()}`
  );
}

/**
 * Create a unique Cloudprinter item reference.
 */
function buildCloudprinterItemReference({
  orderId,
  itemId,
  productKind,
}) {
  return sanitizeReference(
    `fsp-${productKind}-item-${orderId}-${itemId}`,
    `fsp-${productKind}-item-${Date.now()}`
  );
}

/**
 * Normalize the requested product kind.
 */
function normalizeProductKind(
  productKind
) {
  return cleanString(
    productKind,
    "journal"
  ).toLowerCase() ===
    "calendar"
    ? "calendar"
    : "journal";
}

/**
 * Return the Cloudprinter configuration for a product.
 */
function getCloudprinterProductConfiguration({
  productKind,
  totalPages,
}) {
  const normalizedKind =
    normalizeProductKind(
      productKind
    );

  if (
    normalizedKind ===
    "calendar"
  ) {
    const normalizedPages =
      Number(
        totalPages ||
          DEFAULT_CALENDAR_TOTAL_PAGES
      );

    if (
      normalizedPages !==
      DEFAULT_CALENDAR_TOTAL_PAGES
    ) {
      throw new Error(
        `The selected calendar product requires exactly ${DEFAULT_CALENDAR_TOTAL_PAGES} pages`
      );
    }

    return {
      productKind:
        "calendar",

      productReference:
        getEnvironmentVariable(
          "CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE",
          DEFAULT_CALENDAR_PRODUCT_REFERENCE
        ),

      shippingLevel:
        getEnvironmentVariable(
          "CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL",
          DEFAULT_CALENDAR_SHIPPING_LEVEL
        ),

      totalPages:
        DEFAULT_CALENDAR_TOTAL_PAGES,

      filesBuilder:
        buildCalendarFiles,

      optionsBuilder:
        buildCalendarOptions,
    };
  }

  const normalizedPages =
    Number(
      totalPages ||
        DEFAULT_JOURNAL_TOTAL_PAGES
    );

  return {
    productKind:
      "journal",

    productReference:
      getEnvironmentVariable(
        "CLOUDPRINTER_PRODUCT_REFERENCE",
        DEFAULT_JOURNAL_PRODUCT_REFERENCE
      ),

    shippingLevel:
      getEnvironmentVariable(
        "CLOUDPRINTER_SHIPPING_LEVEL",
        DEFAULT_JOURNAL_SHIPPING_LEVEL
      ),

    totalPages:
      normalizedPages,

    filesBuilder:
      buildJournalFiles,

    optionsBuilder: () =>
      buildJournalOptions(
        normalizedPages
      ),
  };
}

/**
 * Build the complete Cloudprinter payload.
 */
function buildCloudprinterOrderPayload({
  order,
  lineItem,
  uploadedFiles,
  totalPages =
    DEFAULT_JOURNAL_TOTAL_PAGES,
  productKind = "journal",
}) {
  if (!order?.id) {
    throw new Error(
      "A Shopify order with an ID is required"
    );
  }

  if (!lineItem?.id) {
    throw new Error(
      "A Shopify line item with an ID is required"
    );
  }

  const apiKey =
    requireEnvironmentVariable(
      "CLOUDPRINTER_API_KEY"
    );

  const supportEmail =
    firstAvailable(
      process.env
        .CLOUDPRINTER_SUPPORT_EMAIL,
      order.email,
      order.contact_email
    );

  if (!supportEmail) {
    throw new Error(
      "CLOUDPRINTER_SUPPORT_EMAIL is not configured and the Shopify order does not contain an email"
    );
  }

  const configuration =
    getCloudprinterProductConfiguration({
      productKind,
      totalPages,
    });

  const orderId =
    String(order.id);

  const orderNumber =
    firstAvailable(
      order.order_number,
      order.name,
      order.id
    );

  const itemId =
    String(lineItem.id);

  const quantity =
    Number(
      lineItem.quantity ||
        1
    );

  if (
    !Number.isInteger(
      quantity
    ) ||
    quantity <= 0
  ) {
    throw new Error(
      `Invalid Shopify quantity for item ${itemId}`
    );
  }

  const orderReference =
    buildCloudprinterOrderReference({
      orderId,
      orderNumber,
      itemId,
      productKind:
        configuration.productKind,
    });

  const itemReference =
    buildCloudprinterItemReference({
      orderId,
      itemId,
      productKind:
        configuration.productKind,
    });

  const defaultTitle =
    configuration.productKind ===
    "calendar"
      ? "Fresh Start Paper Calendar"
      : "Fresh Start Paper Journal";

  const title =
    firstAvailable(
      lineItem.title,
      lineItem.name,
      defaultTitle
    );

  const cloudprinterFiles =
    configuration.filesBuilder(
      uploadedFiles
    );

  const cloudprinterOptions =
    configuration.optionsBuilder();

  const payload = {
    apikey: apiKey,

    reference:
      orderReference,

    email:
      supportEmail,

    addresses: [
      buildDeliveryAddress(
        order
      ),
    ],

    items: [
      {
        reference:
          itemReference,

        product:
          configuration
            .productReference,

        shipping_level:
          configuration
            .shippingLevel,

        title,

        count:
          String(quantity),

        files:
          cloudprinterFiles,

        options:
          cloudprinterOptions,
      },
    ],
  };

  return {
    payload,
    orderReference,
    itemReference,
    productKind:
      configuration.productKind,
    productReference:
      configuration
        .productReference,
    shippingLevel:
      configuration
        .shippingLevel,
    totalPages:
      configuration.totalPages,
  };
}

/**
 * Return a readable Cloudprinter error.
 */
function createCloudprinterError(
  error
) {
  const status =
    error.response?.status;

  const responseData =
    error.response?.data;

  const responseText =
    responseData === undefined
      ? ""
      : typeof responseData ===
        "string"
      ? responseData
      : JSON.stringify(
          responseData,
          null,
          2
        );

  if (status) {
    return new Error(
      [
        `Cloudprinter returned HTTP ${status}`,
        responseText,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (
    error.code ===
    "ECONNABORTED"
  ) {
    return new Error(
      "The Cloudprinter request timed out"
    );
  }

  return new Error(
    `Unable to contact Cloudprinter: ${error.message}`
  );
}

/**
 * Submit one Shopify line item to Cloudprinter.
 *
 * Journals:
 * - book + cover
 *
 * Calendars:
 * - product
 */
async function submitCloudprinterOrder({
  order,
  lineItem,
  uploadedFiles,
  totalPages =
    DEFAULT_JOURNAL_TOTAL_PAGES,
  productKind = "journal",
}) {
  const {
    payload,
    orderReference,
    itemReference,
    productKind:
      resolvedProductKind,
    productReference,
    shippingLevel,
    totalPages:
      resolvedTotalPages,
  } =
    buildCloudprinterOrderPayload({
      order,
      lineItem,
      uploadedFiles,
      totalPages,
      productKind,
    });

  console.log(
    "===== CLOUDPRINTER ORDER SUBMISSION STARTED ====="
  );

  console.log({
    orderReference,
    itemReference,
    productKind:
      resolvedProductKind,
    shopifyOrderId:
      order.id,
    shopifyOrderNumber:
      order.order_number ||
      order.name ||
      order.id,
    shopifyItemId:
      lineItem.id,
    product:
      productReference,
    quantity:
      payload.items[0].count,
    shippingLevel,
    totalPages:
      resolvedTotalPages,
    fileTypes:
      payload.items[0].files.map(
        (file) =>
          file.type
      ),
    optionTypes:
      payload.items[0].options.map(
        (option) =>
          option.type
      ),
    deliveryCountry:
      payload.addresses[0]
        .country,
    apiKeyConfigured: true,
  });

  let response;

  try {
    response =
      await axios.post(
        CLOUDPRINTER_ORDERS_ADD_URL,
        payload,
        {
          timeout: 45000,

          maxBodyLength:
            Infinity,

          headers: {
            Accept:
              "application/json",
            "Content-Type":
              "application/json",
          },

          validateStatus:
            () => true,
        }
      );
  } catch (error) {
    throw createCloudprinterError(
      error
    );
  }

  if (
    response.status !==
    201
  ) {
    const requestError =
      new Error(
        [
          `Cloudprinter rejected order ${orderReference} with HTTP ${response.status}`,
          typeof response.data ===
          "string"
            ? response.data
            : JSON.stringify(
                response.data,
                null,
                2
              ),
        ].join("\n")
      );

    requestError.status =
      response.status;

    requestError.responseData =
      response.data;

    throw requestError;
  }

  console.log(
    "===== CLOUDPRINTER ORDER SUBMITTED ====="
  );

  console.log({
    orderReference,
    itemReference,
    productKind:
      resolvedProductKind,
    status:
      response.status,
    response:
      response.data,
  });

  return {
    success: true,
    productKind:
      resolvedProductKind,
    productReference,
    orderReference,
    itemReference,
    status:
      response.status,
    response:
      response.data,
  };
}

module.exports = {
  submitCloudprinterOrder,
  buildCloudprinterOrderPayload,
  buildJournalFiles,
  buildCalendarFiles,
  buildJournalOptions,
  buildCalendarOptions,
};