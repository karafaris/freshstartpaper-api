const axios = require("axios");

const CLOUDPRINTER_ORDERS_ADD_URL =
  "https://api.cloudprinter.com/cloudcore/1.0/orders/add";

const DEFAULTS = Object.freeze({
  journal: {
    productReference:
      "textbook_pb_1025x6630_l_fc_ink",

    shippingLevel:
      "cp_ground",

    totalPages:
      366,

    mainPaper:
      "pageblock_80off",

    coverPaper:
      "cover_250ecb",

    coverFinish:
      "cover_finish_gloss",
  },

  calendar: {
    productReference:
      "calendar_wall_int_a5_l_double_fc_tnr",

    shippingLevel:
      "cp_ground",

    totalPages:
      13,

    paper:
      "paper_170mcg",

    pageOption:
      "calendar_13_pages",
  },

  notebook: {
    productReference:
      "textbook_co_a3_l_fc_ink",

    shippingLevel:
      "cp_ground",

    totalPages:
      365,

    mainPaper:
      "pageblock_80off",

    coverPaper:
      "cover_250ecb",

    coverFinish:
      "cover_finish_gloss",
  },
});

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
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

  const cleaned =
    String(value).trim();

  return cleaned || fallback;
}

function firstAvailable(
  ...values
) {
  for (
    const value
    of values
  ) {
    const cleaned =
      cleanString(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function getEnvironmentVariable(
  name,
  fallback = ""
) {
  return cleanString(
    process.env[name],
    fallback
  );
}

function requireEnvironmentVariable(
  name
) {
  const value =
    getEnvironmentVariable(
      name
    );

  if (!value) {
    throw new Error(
      `${name} is not configured`
    );
  }

  return value;
}

function sanitizeReference(
  value,
  fallback
) {
  const sanitized =
    cleanString(
      value,
      fallback
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
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

  return sanitized || fallback;
}

/*
|--------------------------------------------------------------------------
| Product kinds and page counts
|--------------------------------------------------------------------------
*/

function normalizeProductKind(
  productKind
) {
  const normalized =
    cleanString(
      productKind,
      "journal"
    ).toLowerCase();

  if (
    [
      "journal",
      "calendar",
      "notebook",
    ].includes(
      normalized
    )
  ) {
    return normalized;
  }

  return "journal";
}

function getDefaultTotalPages(
  productKind
) {
  return DEFAULTS[
    normalizeProductKind(
      productKind
    )
  ].totalPages;
}

function validateTotalPages(
  productKind,
  totalPages
) {
  const normalizedKind =
    normalizeProductKind(
      productKind
    );

  const normalizedPages =
    Number(totalPages);

  if (
    !Number.isInteger(
      normalizedPages
    ) ||
    normalizedPages <= 0
  ) {
    throw new Error(
      `${normalizedKind} totalPages must be a positive whole number`
    );
  }

  if (
    normalizedKind ===
      "calendar" &&
    normalizedPages !==
      DEFAULTS.calendar
        .totalPages
  ) {
    throw new Error(
      `The selected calendar product requires exactly ${DEFAULTS.calendar.totalPages} pages`
    );
  }

  if (
    normalizedKind ===
      "notebook" &&
    normalizedPages !==
      DEFAULTS.notebook
        .totalPages
  ) {
    throw new Error(
      `The selected notebook product requires exactly ${DEFAULTS.notebook.totalPages} pages`
    );
  }

  return normalizedPages;
}

/*
|--------------------------------------------------------------------------
| Delivery address
|--------------------------------------------------------------------------
*/

function normalizeCountryCode(
  address
) {
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
    "united states":
      "US",

    "united states of america":
      "US",

    usa:
      "US",

    canada:
      "CA",

    mexico:
      "MX",

    "united kingdom":
      "GB",

    england:
      "GB",

    scotland:
      "GB",

    wales:
      "GB",

    ireland:
      "IE",

    australia:
      "AU",

    "new zealand":
      "NZ",

    germany:
      "DE",

    france:
      "FR",

    italy:
      "IT",

    spain:
      "ES",

    netherlands:
      "NL",

    belgium:
      "BE",
  };

  return (
    knownCountries[
      countryName
    ] || ""
  );
}

function normalizeStateCode(
  address
) {
  const stateCode =
    firstAvailable(
      address?.province_code,
      address?.state_code
    ).toUpperCase();

  if (
    /^[A-Z]{2}$/.test(
      stateCode
    )
  ) {
    return stateCode;
  }

  return cleanString(
    address?.province ||
      address?.state
  );
}

function getShopifyDeliveryAddress(
  order
) {
  return (
    order?.shipping_address ||
    order?.billing_address ||
    null
  );
}

function buildDeliveryAddress(
  order
) {
  const sourceAddress =
    getShopifyDeliveryAddress(
      order
    );

  if (!sourceAddress) {
    throw new Error(
      "The Shopify order does not contain a shipping or billing address"
    );
  }

  const firstName =
    firstAvailable(
      sourceAddress.first_name,
      order?.customer
        ?.first_name,
      "Customer"
    );

  const lastName =
    firstAvailable(
      sourceAddress.last_name,
      order?.customer
        ?.last_name,
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
    missingFields.push(
      "firstname"
    );
  }

  if (!lastName) {
    missingFields.push(
      "lastname"
    );
  }

  if (!street1) {
    missingFields.push(
      "street1"
    );
  }

  if (!zip) {
    missingFields.push(
      "zip"
    );
  }

  if (!city) {
    missingFields.push(
      "city"
    );
  }

  if (!country) {
    missingFields.push(
      "country ISO code"
    );
  }

  if (!customerEmail) {
    missingFields.push(
      "email"
    );
  }

  if (!customerPhone) {
    missingFields.push(
      "phone"
    );
  }

  if (
    [
      "US",
      "CA",
    ].includes(
      country
    ) &&
    !state
  ) {
    missingFields.push(
      "state/province code"
    );
  }

  if (
    missingFields.length >
    0
  ) {
    throw new Error(
      `The delivery address is missing required Cloudprinter fields: ${missingFields.join(
        ", "
      )}`
    );
  }

  const deliveryAddress = {
    type:
      "delivery",

    company:
      cleanString(
        sourceAddress.company
      ),

    firstname:
      firstName,

    lastname:
      lastName,

    street1,

    zip,

    city,

    country,

    email:
      customerEmail,

    phone:
      customerPhone,
  };

  if (street2) {
    deliveryAddress.street2 =
      street2;
  }

  if (state) {
    deliveryAddress.state =
      state;
  }

  return deliveryAddress;
}

/*
|--------------------------------------------------------------------------
| Uploaded files
|--------------------------------------------------------------------------
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

  const url =
    firstAvailable(
      file.url,
      file.secureUrl,
      file.secure_url
    );

  const md5sum =
    cleanString(
      file.md5sum
    );

  if (!url) {
    throw new Error(
      `The uploaded ${expectedType} PDF does not have a URL`
    );
  }

  if (
    !url
      .toLowerCase()
      .startsWith(
        "https://"
      )
  ) {
    throw new Error(
      `The uploaded ${expectedType} PDF URL must use HTTPS`
    );
  }

  if (
    !/^[a-f0-9]{32}$/i.test(
      md5sum
    )
  ) {
    throw new Error(
      `The uploaded ${expectedType} PDF does not have a valid MD5 checksum`
    );
  }

  return {
    type:
      cloudprinterType,

    url,

    md5sum,
  };
}

/*
|--------------------------------------------------------------------------
| Dynamic file mapping
|--------------------------------------------------------------------------
|
| productResolver.js supplies mappings such as:
|
| Notebook:
| interior -> book
| cover    -> cover
|
| Calendar:
| product  -> product
|
*/

function buildConfiguredFiles(
  uploadedFiles,
  requiredFiles
) {
  if (
    !Array.isArray(
      requiredFiles
    ) ||
    requiredFiles.length ===
      0
  ) {
    throw new Error(
      "The product configuration does not contain requiredFiles"
    );
  }

  return requiredFiles.map(
    (
      fileConfiguration,
      index
    ) => {
      const sourceKey =
        cleanString(
          fileConfiguration
            ?.sourceKey
        );

      const cloudprinterType =
        cleanString(
          fileConfiguration
            ?.cloudprinterType
        );

      if (!sourceKey) {
        throw new Error(
          `Product requiredFiles entry ${index + 1} is missing sourceKey`
        );
      }

      if (
        !cloudprinterType
      ) {
        throw new Error(
          `The required file "${sourceKey}" is missing cloudprinterType`
        );
      }

      return normalizeUploadedFile({
        file:
          uploadedFiles?.[
            sourceKey
          ],

        expectedType:
          sourceKey,

        cloudprinterType,
      });
    }
  );
}

function buildJournalFiles(
  uploadedFiles
) {
  return buildConfiguredFiles(
    uploadedFiles,
    [
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
    ]
  );
}

function buildNotebookFiles(
  uploadedFiles
) {
  return buildJournalFiles(
    uploadedFiles
  );
}

function buildCalendarFiles(
  uploadedFiles
) {
  return buildConfiguredFiles(
    uploadedFiles,
    [
      {
        sourceKey:
          "product",

        cloudprinterType:
          "product",
      },
    ]
  );
}

/*
|--------------------------------------------------------------------------
| Cloudprinter options
|--------------------------------------------------------------------------
*/

function normalizeOptions(
  options
) {
  if (
    !Array.isArray(
      options
    ) ||
    options.length === 0
  ) {
    throw new Error(
      "The product configuration does not contain Cloudprinter options"
    );
  }

  return options.map(
    (
      option,
      index
    ) => {
      const type =
        cleanString(
          option?.type
        );

      const count =
        cleanString(
          option?.count
        );

      if (!type) {
        throw new Error(
          `Cloudprinter option ${index + 1} is missing type`
        );
      }

      if (!count) {
        throw new Error(
          `Cloudprinter option "${type}" is missing count`
        );
      }

      return {
        type,
        count,
      };
    }
  );
}

function buildJournalOptions(
  totalPages
) {
  const normalizedPages =
    validateTotalPages(
      "journal",
      totalPages
    );

  const mainPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_MAIN_PAPER",
      DEFAULTS.journal
        .mainPaper
    );

  const coverPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_PAPER",
      DEFAULTS.journal
        .coverPaper
    );

  const coverFinish =
    getEnvironmentVariable(
      "CLOUDPRINTER_COVER_FINISH",
      DEFAULTS.journal
        .coverFinish
    );

  return [
    {
      type:
        "total_pages",

      count:
        String(
          normalizedPages
        ),
    },

    {
      type:
        mainPaper,

      count:
        String(
          normalizedPages
        ),
    },

    {
      type:
        coverPaper,

      count:
        "1",
    },

    {
      type:
        coverFinish,

      count:
        "1",
    },
  ];
}

function buildNotebookOptions(
  totalPages
) {
  const normalizedPages =
    validateTotalPages(
      "notebook",
      totalPages
    );

  const mainPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_NOTEBOOK_MAIN_PAPER",

      getEnvironmentVariable(
        "CLOUDPRINTER_MAIN_PAPER",
        DEFAULTS.notebook
          .mainPaper
      )
    );

  const coverPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_NOTEBOOK_COVER_PAPER",

      getEnvironmentVariable(
        "CLOUDPRINTER_COVER_PAPER",
        DEFAULTS.notebook
          .coverPaper
      )
    );

  const coverFinish =
    getEnvironmentVariable(
      "CLOUDPRINTER_NOTEBOOK_COVER_FINISH",

      getEnvironmentVariable(
        "CLOUDPRINTER_COVER_FINISH",
        DEFAULTS.notebook
          .coverFinish
      )
    );

  return [
    {
      type:
        "total_pages",

      count:
        String(
          normalizedPages
        ),
    },

    {
      type:
        mainPaper,

      count:
        String(
          normalizedPages
        ),
    },

    {
      type:
        coverPaper,

      count:
        "1",
    },

    {
      type:
        coverFinish,

      count:
        "1",
    },
  ];
}

function buildCalendarOptions() {
  const calendarPaper =
    getEnvironmentVariable(
      "CLOUDPRINTER_CALENDAR_PAPER",
      DEFAULTS.calendar
        .paper
    );

  const calendarPageOption =
    getEnvironmentVariable(
      "CLOUDPRINTER_CALENDAR_PAGE_OPTION",
      DEFAULTS.calendar
        .pageOption
    );

  return [
    {
      type:
        calendarPaper,

      count:
        "1",
    },

    {
      type:
        calendarPageOption,

      count:
        "1",
    },
  ];
}

/*
|--------------------------------------------------------------------------
| Legacy product configuration
|--------------------------------------------------------------------------
|
| This keeps existing journal and calendar scripts compatible when
| they still pass productKind instead of productConfiguration.
|
*/

function getLegacyProductConfiguration({
  productKind,
  totalPages,
}) {
  const normalizedKind =
    normalizeProductKind(
      productKind
    );

  const normalizedPages =
    validateTotalPages(
      normalizedKind,

      totalPages ||
        getDefaultTotalPages(
          normalizedKind
        )
    );

  if (
    normalizedKind ===
    "calendar"
  ) {
    return {
      productKind:
        "calendar",

      productReference:
        getEnvironmentVariable(
          "CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE",
          DEFAULTS.calendar
            .productReference
        ),

      shippingLevel:
        getEnvironmentVariable(
          "CLOUDPRINTER_CALENDAR_SHIPPING_LEVEL",
          DEFAULTS.calendar
            .shippingLevel
        ),

      totalPages:
        normalizedPages,

      requiredFiles: [
        {
          sourceKey:
            "product",

          cloudprinterType:
            "product",
        },
      ],

      options:
        buildCalendarOptions(),
    };
  }

  if (
    normalizedKind ===
    "notebook"
  ) {
    return {
      productKind:
        "notebook",

      productReference:
        getEnvironmentVariable(
          "CLOUDPRINTER_NOTEBOOK_PRODUCT_REFERENCE",
          DEFAULTS.notebook
            .productReference
        ),

      shippingLevel:
        getEnvironmentVariable(
          "CLOUDPRINTER_NOTEBOOK_SHIPPING_LEVEL",

          getEnvironmentVariable(
            "CLOUDPRINTER_SHIPPING_LEVEL",
            DEFAULTS.notebook
              .shippingLevel
          )
        ),

      totalPages:
        normalizedPages,

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

      options:
        buildNotebookOptions(
          normalizedPages
        ),
    };
  }

  return {
    productKind:
      "journal",

    productReference:
      getEnvironmentVariable(
        "CLOUDPRINTER_JOURNAL_PRODUCT_REFERENCE",

        getEnvironmentVariable(
          "CLOUDPRINTER_PRODUCT_REFERENCE",
          DEFAULTS.journal
            .productReference
        )
      ),

    shippingLevel:
      getEnvironmentVariable(
        "CLOUDPRINTER_JOURNAL_SHIPPING_LEVEL",

        getEnvironmentVariable(
          "CLOUDPRINTER_SHIPPING_LEVEL",
          DEFAULTS.journal
            .shippingLevel
        )
      ),

    totalPages:
      normalizedPages,

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

    options:
      buildJournalOptions(
        normalizedPages
      ),
  };
}

/*
|--------------------------------------------------------------------------
| productResolver.js configuration
|--------------------------------------------------------------------------
*/

function normalizeResolverConfiguration({
  productConfiguration,
  productKind,
  totalPages,
}) {
  if (
    !productConfiguration ||
    typeof productConfiguration !==
      "object"
  ) {
    return getLegacyProductConfiguration({
      productKind,
      totalPages,
    });
  }

  const normalizedKind =
    normalizeProductKind(
      productConfiguration.kind ||
        productKind
    );

  const normalizedPages =
    validateTotalPages(
      normalizedKind,

      productConfiguration
        .totalPages ||
        totalPages ||
        getDefaultTotalPages(
          normalizedKind
        )
    );

  const productReference =
    cleanString(
      productConfiguration
        .productReference
    );

  const shippingLevel =
    cleanString(
      productConfiguration
        .shippingLevel
    );

  if (!productReference) {
    throw new Error(
      `The ${normalizedKind} product configuration is missing productReference`
    );
  }

  if (!shippingLevel) {
    throw new Error(
      `The ${normalizedKind} product configuration is missing shippingLevel`
    );
  }

  let options;

  if (
    normalizedKind ===
    "calendar"
  ) {
    /*
     * Preserve the existing confirmed calendar options:
     * paper_170mcg and calendar_13_pages.
     */

    options =
      buildCalendarOptions();
  } else if (
    Array.isArray(
      productConfiguration
        .options
    ) &&
    productConfiguration
      .options.length > 0
  ) {
    options =
      normalizeOptions(
        productConfiguration
          .options
      );
  } else if (
    normalizedKind ===
    "notebook"
  ) {
    options =
      buildNotebookOptions(
        normalizedPages
      );
  } else {
    options =
      buildJournalOptions(
        normalizedPages
      );
  }

  return {
    productKind:
      normalizedKind,

    productReference,

    shippingLevel,

    totalPages:
      normalizedPages,

    requiredFiles:
      productConfiguration
        .requiredFiles,

    options,
  };
}

/*
|--------------------------------------------------------------------------
| Cloudprinter references
|--------------------------------------------------------------------------
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
    Date.now().toString(
      36
    );

  return sanitizeReference(
    `${baseReference}-${timestampSuffix}`,

    `fsp-${productKind}-${Date.now()}`
  );
}

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

/*
|--------------------------------------------------------------------------
| Build Cloudprinter order payload
|--------------------------------------------------------------------------
*/

function buildCloudprinterOrderPayload({
  order,
  lineItem,
  uploadedFiles,

  totalPages =
    DEFAULTS.journal
      .totalPages,

  productKind =
    "journal",

  productConfiguration =
    null,
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
    normalizeResolverConfiguration({
      productConfiguration,
      productKind,
      totalPages,
    });

  const orderId =
    String(
      order.id
    );

  const orderNumber =
    firstAvailable(
      order.order_number,
      order.name,
      order.id
    );

  const itemId =
    String(
      lineItem.id
    );

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
        configuration
          .productKind,
    });

  const itemReference =
    buildCloudprinterItemReference({
      orderId,
      itemId,

      productKind:
        configuration
          .productKind,
    });

  const defaultTitles = {
    journal:
      "Fresh Start Paper Journal",

    calendar:
      "Fresh Start Paper Calendar",

    notebook:
      "Fresh Start Paper Notebook",
  };

  const title =
    firstAvailable(
      lineItem.title,
      lineItem.name,

      defaultTitles[
        configuration
          .productKind
      ]
    );

  const cloudprinterFiles =
    buildConfiguredFiles(
      uploadedFiles,
      configuration
        .requiredFiles
    );

  const cloudprinterOptions =
    normalizeOptions(
      configuration.options
    );

  const payload = {
    apikey:
      apiKey,

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
          String(
            quantity
          ),

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
      configuration
        .productKind,

    productReference:
      configuration
        .productReference,

    shippingLevel:
      configuration
        .shippingLevel,

    totalPages:
      configuration
        .totalPages,
  };
}

/*
|--------------------------------------------------------------------------
| Cloudprinter errors
|--------------------------------------------------------------------------
*/

function createCloudprinterError(
  error
) {
  const status =
    error.response
      ?.status;

  const responseData =
    error.response
      ?.data;

  const responseText =
    responseData ===
    undefined
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
        .filter(
          Boolean
        )
        .join(
          "\n"
        )
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

/*
|--------------------------------------------------------------------------
| Submit Cloudprinter order
|--------------------------------------------------------------------------
*/

async function submitCloudprinterOrder({
  order,
  lineItem,
  uploadedFiles,

  totalPages =
    DEFAULTS.journal
      .totalPages,

  productKind =
    "journal",

  productConfiguration =
    null,
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
      productConfiguration,
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
      payload.items[0]
        .count,

    shippingLevel,

    totalPages:
      resolvedTotalPages,

    fileTypes:
      payload.items[0]
        .files.map(
          (file) =>
            file.type
        ),

    optionTypes:
      payload.items[0]
        .options.map(
          (option) =>
            option.type
        ),

    deliveryCountry:
      payload.addresses[0]
        .country,

    apiKeyConfigured:
      true,
  });

  let response;

  try {
    response =
      await axios.post(
        CLOUDPRINTER_ORDERS_ADD_URL,

        payload,

        {
          timeout:
            45000,

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
        ].join(
          "\n"
        )
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
    success:
      true,

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

  buildConfiguredFiles,

  buildJournalFiles,

  buildNotebookFiles,

  buildCalendarFiles,

  buildJournalOptions,

  buildNotebookOptions,

  buildCalendarOptions,
};