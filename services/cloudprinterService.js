const axios = require("axios");

const CLOUDPRINTER_ORDERS_ADD_URL =
  "https://api.cloudprinter.com/cloudcore/1.0/orders/add";

const DEFAULT_PRODUCT_REFERENCE =
  "textbook_pb_1025x6630_l_fc_ink";

const DEFAULT_SHIPPING_LEVEL =
  "cp_postal";

const DEFAULT_MAIN_PAPER =
  "pageblock_80off";

const DEFAULT_COVER_PAPER =
  "cover_250ecb";

const DEFAULT_COVER_FINISH =
  "cover_finish_gloss";

const DEFAULT_TOTAL_PAGES = 366;

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
 * Convert an unknown value to a clean string.
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
 * Prevent Cloudprinter references from containing unsupported
 * characters.
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
 * Return the first available non-empty value.
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
 * Shopify may provide country_code or the full country name.
 *
 * Cloudprinter requires an ISO 3166-1 alpha-2 country code.
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
 * Cloudprinter requires a two-character state code for US and
 * Canadian addresses.
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
 * Get the delivery address from the Shopify order.
 */
function getShopifyDeliveryAddress(order) {
  return (
    order?.shipping_address ||
    order?.billing_address ||
    null
  );
}

/**
 * Build the Cloudprinter delivery-address object.
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
 * Validate and normalize one uploaded PDF.
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
 * Build the list of PDF files Cloudprinter will download.
 *
 * Cloudprinter calls the interior file "book". Your existing
 * Cloudinary service calls it "product", so it is converted here.
 */
function buildCloudprinterFiles(
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
 * Build the options enabled for the selected Cloudprinter
 * textbook product.
 */
function buildCloudprinterOptions(
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
      "Cloudprinter totalPages must be a positive whole number"
    );
  }

  const mainPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_MAIN_PAPER",
      DEFAULT_MAIN_PAPER
    );

  const coverPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_PAPER",
      DEFAULT_COVER_PAPER
    );

  const coverFinish =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_FINISH",
      DEFAULT_COVER_FINISH
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
 * Generate a unique Cloudprinter order reference.
 *
 * Cloudprinter requires each order reference to be unique.
 */
function buildCloudprinterOrderReference({
  orderId,
  orderNumber,
  itemId,
}) {
  const baseReference =
    sanitizeReference(
      `fsp-${orderNumber}-${orderId}-${itemId}`,
      `fsp-${Date.now()}`
    );

  /*
   * Add a short timestamp suffix so a Shopify webhook replay
   * does not accidentally reuse an already submitted reference.
   */
  const timestampSuffix =
    Date.now().toString(36);

  return sanitizeReference(
    `${baseReference}-${timestampSuffix}`,
    `fsp-${Date.now()}`
  );
}

/**
 * Build a unique item reference inside the Cloudprinter order.
 */
function buildCloudprinterItemReference({
  orderId,
  itemId,
}) {
  return sanitizeReference(
    `fsp-item-${orderId}-${itemId}`,
    `fsp-item-${Date.now()}`
  );
}

/**
 * Create the Cloudprinter request body.
 */
function buildCloudprinterOrderPayload({
  order,
  lineItem,
  uploadedFiles,
  totalPages = DEFAULT_TOTAL_PAGES,
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

  const productReference =
    getEnvironmentVariable(
      "CLOUDPRINTER_PRODUCT_REFERENCE",
      DEFAULT_PRODUCT_REFERENCE
    );

  const shippingLevel =
    getEnvironmentVariable(
      "CLOUDPRINTER_SHIPPING_LEVEL",
      DEFAULT_SHIPPING_LEVEL
    );

  const orderId = String(order.id);

  const orderNumber =
    firstAvailable(
      order.order_number,
      order.name,
      order.id
    );

  const itemId = String(
    lineItem.id
  );

  const quantity =
    Number(lineItem.quantity || 1);

  if (
    !Number.isInteger(quantity) ||
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
    });

  const itemReference =
    buildCloudprinterItemReference({
      orderId,
      itemId,
    });

  const title =
    firstAvailable(
      lineItem.title,
      lineItem.name,
      "Fresh Start Paper Journal"
    );

  const payload = {
    apikey: apiKey,

    reference: orderReference,

    /*
     * Cloudprinter documents this as the client's support
     * email for processing or production questions.
     */
    email: supportEmail,

    addresses: [
      buildDeliveryAddress(order),
    ],

    items: [
      {
        reference: itemReference,

        product:
          productReference,

        shipping_level:
          shippingLevel,

        title,

        count: String(quantity),

        files:
          buildCloudprinterFiles(
            uploadedFiles
          ),

        options:
          buildCloudprinterOptions(
            totalPages
          ),
      },
    ],
  };

  return {
    payload,
    orderReference,
    itemReference,
  };
}

/**
 * Return a readable Cloudprinter API error.
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
    error.code === "ECONNABORTED"
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
 */
async function submitCloudprinterOrder({
  order,
  lineItem,
  uploadedFiles,
  totalPages = DEFAULT_TOTAL_PAGES,
}) {
  const {
    payload,
    orderReference,
    itemReference,
  } =
    buildCloudprinterOrderPayload({
      order,
      lineItem,
      uploadedFiles,
      totalPages,
    });

  console.log(
    "===== CLOUDPRINTER ORDER SUBMISSION STARTED ====="
  );

  console.log({
    orderReference,
    itemReference,
    shopifyOrderId:
      order.id,
    shopifyOrderNumber:
      order.order_number ||
      order.name ||
      order.id,
    shopifyItemId:
      lineItem.id,
    product:
      payload.items[0].product,
    quantity:
      payload.items[0].count,
    shippingLevel:
      payload.items[0]
        .shipping_level,
    totalPages,
    deliveryCountry:
      payload.addresses[0]
        .country,
    /*
     * Do not log the API key.
     */
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

          maxBodyLength: Infinity,

          headers: {
            Accept:
              "application/json",
            "Content-Type":
              "application/json",
          },

          /*
           * Cloudprinter documents HTTP 201 as the successful
           * response for creating an order.
           */
          validateStatus:
            () => true,
        }
      );
  } catch (error) {
    throw createCloudprinterError(
      error
    );
  }

  if (response.status !== 201) {
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
    status:
      response.status,
    response:
      response.data,
  });

  return {
    success: true,
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
};