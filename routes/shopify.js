const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const axios = require("axios");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const {
  generateCalendarPDFs,
} = require("../services/calendarPdfGenerator");

const {
  generateNotebookPDFs,
} = require("../services/notebookPdfGenerator");

const {
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
} = require("../services/cloudinaryService");

const {
  uploadCalendarPdf,
} = require("../services/calendarCloudinaryService");

const {
  saveOrderFiles,
  getOrderFiles,
} = require("../services/orderFileStore");

const {
  submitCloudprinterOrder,
} = require("../services/cloudprinterService");

const {
  resolveProduct,
} = require("../services/productResolver");

const router = express.Router();

const SHOPIFY_ADMIN_API_VERSION =
  "2026-07";

let recoveryCachedAccessToken = null;

let recoveryCachedAccessTokenExpiresAt =
  0;

const recoveryOrdersInProgress =
  new Set();

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

function normalizeShopifyStore(
  store
) {
  return cleanString(store)
    .replace(
      /^https?:\/\//i,
      ""
    )
    .replace(
      /\/+$/,
      ""
    );
}

function extractNumericId(
  value
) {
  const cleaned =
    cleanString(value);

  if (!cleaned) {
    return null;
  }

  if (/^\d+$/.test(cleaned)) {
    return cleaned;
  }

  const pieces =
    cleaned.split("/");

  const last =
    pieces[
      pieces.length - 1
    ];

  if (
    last &&
    /^\d+$/.test(last)
  ) {
    return last;
  }

  return null;
}

function safeSecretEqual(
  suppliedSecret,
  expectedSecret
) {
  const supplied =
    cleanString(
      suppliedSecret
    );

  const expected =
    cleanString(
      expectedSecret
    );

  if (
    !supplied ||
    !expected
  ) {
    return false;
  }

  const suppliedBuffer =
    Buffer.from(
      supplied,
      "utf8"
    );

  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8"
    );

  if (
    suppliedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    suppliedBuffer,
    expectedBuffer
  );
}

/*
|--------------------------------------------------------------------------
| Verify Shopify webhook
|--------------------------------------------------------------------------
*/

function verifyShopifyWebhook({
  rawBody,
  receivedHmac,
  webhookSecret,
}) {
  if (
    !Buffer.isBuffer(
      rawBody
    )
  ) {
    return false;
  }

  if (
    !receivedHmac ||
    !webhookSecret
  ) {
    return false;
  }

  const calculatedHmac =
    crypto
      .createHmac(
        "sha256",
        webhookSecret
      )
      .update(
        rawBody
      )
      .digest(
        "base64"
      );

  let receivedBuffer;

  let calculatedBuffer;

  try {
    receivedBuffer =
      Buffer.from(
        receivedHmac,
        "base64"
      );

    calculatedBuffer =
      Buffer.from(
        calculatedHmac,
        "base64"
      );
  } catch (error) {
    console.error(
      "Unable to convert Shopify HMAC values to buffers",
      error
    );

    return false;
  }

  if (
    receivedBuffer.length !==
    calculatedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    calculatedBuffer
  );
}

/*
|--------------------------------------------------------------------------
| Validate line item
|--------------------------------------------------------------------------
*/

function isValidLineItem(
  lineItem
) {
  return Boolean(
    lineItem &&
      lineItem.id &&
      Number(
        lineItem.quantity ||
        0
      ) > 0
  );
}

/*
|--------------------------------------------------------------------------
| Delete temporary calendar PDF
|--------------------------------------------------------------------------
*/

async function deleteCalendarLocalFile(
  productPath
) {
  if (!productPath) {
    return;
  }

  try {
    await fs.promises.unlink(
      productPath
    );
  } catch (error) {
    if (
      error.code !==
      "ENOENT"
    ) {
      throw error;
    }
  }
}

/*
|--------------------------------------------------------------------------
| Recovery Shopify access token
|--------------------------------------------------------------------------
*/

async function getRecoveryShopifyAccessToken() {
  const shopifyStore =
    normalizeShopifyStore(
      process.env
        .SHOPIFY_STORE
    );

  const clientId =
    cleanString(
      process.env
        .SHOPIFY_CLIENT_ID
    );

  const clientSecret =
    cleanString(
      process.env
        .SHOPIFY_CLIENT_SECRET
    );

  if (!shopifyStore) {
    throw new Error(
      "SHOPIFY_STORE is missing from Render."
    );
  }

  if (!clientId) {
    throw new Error(
      "SHOPIFY_CLIENT_ID is missing from Render."
    );
  }

  if (!clientSecret) {
    throw new Error(
      "SHOPIFY_CLIENT_SECRET is missing from Render."
    );
  }

  const now =
    Date.now();

  if (
    recoveryCachedAccessToken &&
    recoveryCachedAccessTokenExpiresAt >
      now +
      5 *
        60 *
        1000
  ) {
    return recoveryCachedAccessToken;
  }

  const tokenUrl =
    `https://${shopifyStore}` +
    "/admin/oauth/access_token";

  const requestBody =
    new URLSearchParams({
      grant_type:
        "client_credentials",

      client_id:
        clientId,

      client_secret:
        clientSecret,
    });

  console.log(
    "Recovery: requesting Shopify access token."
  );

  const response =
    await axios.post(
      tokenUrl,

      requestBody.toString(),

      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json",
        },

        timeout:
          15000,
      }
    );

  const accessToken =
    response.data
      ?.access_token;

  const expiresInSeconds =
    Number(
      response.data
        ?.expires_in ||
      86399
    );

  if (!accessToken) {
    throw new Error(
      "Shopify did not return an access token."
    );
  }

  recoveryCachedAccessToken =
    accessToken;

  recoveryCachedAccessTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresInSeconds -
        300,
      60
    ) *
      1000;

  console.log(
    "Recovery: Shopify access token acquired."
  );

  return recoveryCachedAccessToken;
}

/*
|--------------------------------------------------------------------------
| Convert Shopify GraphQL address into webhook-style address
|--------------------------------------------------------------------------
*/

function convertGraphqlAddress(
  address
) {
  if (!address) {
    return null;
  }

  return {
    first_name:
      address.firstName ||
      "",

    last_name:
      address.lastName ||
      "",

    company:
      address.company ||
      "",

    address1:
      address.address1 ||
      "",

    address2:
      address.address2 ||
      "",

    city:
      address.city ||
      "",

    zip:
      address.zip ||
      "",

    province:
      address.province ||
      "",

    province_code:
      address.provinceCode ||
      "",

    country:
      address.country ||
      "",

    country_code:
      address.countryCodeV2 ||
      "",

    phone:
      address.phone ||
      "",
  };
}

/*
|--------------------------------------------------------------------------
| Convert GraphQL line item into webhook-style line item
|--------------------------------------------------------------------------
*/

function convertGraphqlLineItem(
  item
) {
  const itemId =
    extractNumericId(
      item.id
    );

  if (!itemId) {
    throw new Error(
      `Unable to determine numeric Shopify line-item ID from ${item.id}`
    );
  }

  const properties =
    Array.isArray(
      item.customAttributes
    )
      ? item.customAttributes.map(
          (
            attribute
          ) => ({
            name:
              attribute.key,

            value:
              attribute.value,
          })
        )
      : [];

  return {
    id:
      itemId,

    /*
     * Not needed for generation or Cloudprinter recovery.
     * Leaving these null avoids requiring extra Shopify product scopes.
     */

    product_id:
      null,

    variant_id:
      null,

    title:
      item.title ||
      item.name ||
      "Custom Product",

    name:
      item.name ||
      item.title ||
      "Custom Product",

    quantity:
      Number(
        item.quantity ||
        1
      ),

    sku:
      item.sku ||
      "",

    variant_title:
      item.variantTitle ||
      "",

    properties,
  };
}

/*
|--------------------------------------------------------------------------
| Convert GraphQL order into webhook-style order
|--------------------------------------------------------------------------
*/

function convertGraphqlOrder(
  graphqlOrder
) {
  const orderId =
    extractNumericId(
      graphqlOrder
        .legacyResourceId
    ) ||
    extractNumericId(
      graphqlOrder.id
    );

  if (!orderId) {
    throw new Error(
      "Unable to determine the numeric Shopify order ID."
    );
  }

  const orderName =
    cleanString(
      graphqlOrder.name
    );

  const orderNumberText =
    orderName
      .replace(
        /^#/,
        ""
      )
      .trim();

  const orderNumber =
    /^\d+$/.test(
      orderNumberText
    )
      ? Number(
          orderNumberText
        )
      : orderNumberText;

  const graphqlLineItems =
    graphqlOrder
      .lineItems
      ?.nodes;

  if (
    !Array.isArray(
      graphqlLineItems
    ) ||
    graphqlLineItems.length ===
      0
  ) {
    throw new Error(
      "The Shopify order does not contain any line items."
    );
  }

  const lineItems =
    graphqlLineItems.map(
      convertGraphqlLineItem
    );

  const shippingAddress =
    convertGraphqlAddress(
      graphqlOrder
        .shippingAddress
    );

  const billingAddress =
    convertGraphqlAddress(
      graphqlOrder
        .billingAddress
    );

  const sourceAddress =
    shippingAddress ||
    billingAddress ||
    null;

  /*
   * IMPORTANT:
   *
   * We intentionally DO NOT query Shopify's Customer object.
   *
   * Shopify requires read_customers permission for that object.
   *
   * The journal generator only uses customer first/last name as a
   * fallback, so we rebuild that information from the order address.
   */

  const customer =
    sourceAddress
      ? {
          first_name:
            sourceAddress
              .first_name ||
            "",

          last_name:
            sourceAddress
              .last_name ||
            "",

          email:
            graphqlOrder.email ||
            "",

          phone:
            shippingAddress
              ?.phone ||
            billingAddress
              ?.phone ||
            "",
        }
      : null;

  return {
    id:
      orderId,

    order_number:
      orderNumber,

    name:
      orderName,

    email:
      graphqlOrder.email ||
      "",

    contact_email:
      graphqlOrder.email ||
      "",

    phone:
      shippingAddress
        ?.phone ||
      billingAddress
        ?.phone ||
      "",

    created_at:
      graphqlOrder
        .createdAt ||
      null,

    financial_status:
      cleanString(
        graphqlOrder
          .displayFinancialStatus
      ).toLowerCase(),

    fulfillment_status:
      null,

    customer,

    shipping_address:
      shippingAddress,

    billing_address:
      billingAddress,

    line_items:
      lineItems,
  };
}

/*
|--------------------------------------------------------------------------
| Find Shopify order for recovery
|--------------------------------------------------------------------------
*/

async function findShopifyOrderForRecovery(
  orderNumber
) {
  const shopifyStore =
    normalizeShopifyStore(
      process.env
        .SHOPIFY_STORE
    );

  const accessToken =
    await getRecoveryShopifyAccessToken();

  const graphqlUrl =
    `https://${shopifyStore}` +
    `/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

  /*
   * IMPORTANT:
   *
   * No customer { } query here.
   *
   * That avoids requiring the read_customers scope.
   */

  const query = `
    query RecoverOrder(
      $searchQuery: String!
    ) {
      orders(
        first: 10
        query: $searchQuery
        sortKey: CREATED_AT
        reverse: true
      ) {
        nodes {
          id
          legacyResourceId
          name
          email
          createdAt
          cancelledAt
          displayFinancialStatus

          shippingAddress {
            firstName
            lastName
            company
            address1
            address2
            city
            zip
            province
            provinceCode
            country
            countryCodeV2
            phone
          }

          billingAddress {
            firstName
            lastName
            company
            address1
            address2
            city
            zip
            province
            provinceCode
            country
            countryCodeV2
            phone
          }

          lineItems(
            first: 100
          ) {
            nodes {
              id
              title
              name
              quantity
              sku
              variantTitle

              customAttributes {
                key
                value
              }
            }
          }
        }
      }
    }
  `;

  const normalizedOrderNumber =
    cleanString(
      orderNumber
    )
      .replace(
        /^#/,
        ""
      )
      .trim();

  const searchQuery =
    `name:#${normalizedOrderNumber}`;

  console.log(
    "Recovery: searching Shopify for",
    searchQuery
  );

  const response =
    await axios.post(
      graphqlUrl,

      {
        query,

        variables: {
          searchQuery,
        },
      },

      {
        headers: {
          "X-Shopify-Access-Token":
            accessToken,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",
        },

        timeout:
          20000,
      }
    );

  if (
    Array.isArray(
      response.data
        ?.errors
    ) &&
    response.data.errors
      .length >
      0
  ) {
    const message =
      response.data.errors
        .map(
          (
            error
          ) =>
            error.message
        )
        .join(
          "; "
        );

    throw new Error(
      `Shopify GraphQL error: ${message}`
    );
  }

  const orders =
    response.data
      ?.data
      ?.orders
      ?.nodes;

  if (
    !Array.isArray(
      orders
    )
  ) {
    throw new Error(
      "Shopify did not return an orders array."
    );
  }

  const matchingOrder =
    orders.find(
      (
        order
      ) =>
        cleanString(
          order.name
        )
          .replace(
            /^#/,
            ""
          )
          .trim() ===
        normalizedOrderNumber
    );

  return (
    matchingOrder ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| Check whether files already exist
|--------------------------------------------------------------------------
*/

async function findExistingOrderFiles(
  order
) {
  const existing = [];

  for (
    const lineItem
    of order.line_items
  ) {
    try {
      const manifest =
        await getOrderFiles({
          orderId:
            order.id,

          itemId:
            lineItem.id,
        });

      if (
        manifest &&
        Array.isArray(
          manifest.files
        ) &&
        manifest.files.length >
          0
      ) {
        existing.push({
          itemId:
            lineItem.id,

          title:
            lineItem.title,

          manifest,
        });
      }
    } catch (error) {
      console.log(
        `Recovery preflight: no existing manifest for item ${lineItem.id}`
      );
    }
  }

  return existing;
}

/*
|--------------------------------------------------------------------------
| Process journal
|--------------------------------------------------------------------------
*/

async function processJournalLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId =
    lineItem.id;

  let generatedFiles =
    null;

  try {
    console.log(
      `Starting JOURNAL PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateJournalPDFs(
        order,
        lineItem
      );

    if (
      !generatedFiles
        ?.interiorPath ||
      !generatedFiles
        ?.coverPath
    ) {
      throw new Error(
        `Journal PDF generation did not return both files for item ${itemId}`
      );
    }

    console.log(
      "===== JOURNAL PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      productKind:
        "journal",

      totalPages:
        productConfiguration
          .totalPages,

      interiorPath:
        generatedFiles
          .interiorPath,

      coverPath:
        generatedFiles
          .coverPath,
    });

    const uploadedFiles =
      await uploadGeneratedPDFs({
        interiorPath:
          generatedFiles
            .interiorPath,

        coverPath:
          generatedFiles
            .coverPath,

        orderId,

        itemId,
      });

    if (
      !uploadedFiles
        ?.interior
        ?.url ||
      !uploadedFiles
        ?.cover
        ?.url ||
      !uploadedFiles
        ?.interior
        ?.md5sum ||
      !uploadedFiles
        ?.cover
        ?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return complete journal files for item ${itemId}`
      );
    }

    console.log(
      "===== JOURNAL CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      interiorUrl:
        uploadedFiles
          .interior
          .url,

      coverUrl:
        uploadedFiles
          .cover
          .url,
    });

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,

        files: [
          uploadedFiles
            .interior,

          uploadedFiles
            .cover,
        ],
      });

    if (
      !storedFiles
        ?.manifestUrl
    ) {
      throw new Error(
        `The journal file manifest was not saved correctly for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration
            .totalPages,

        productConfiguration,
      });

    if (
      !cloudprinterResult
        ?.success
    ) {
      throw new Error(
        `Cloudprinter did not confirm the journal order for item ${itemId}`
      );
    }

    return {
      success:
        true,

      productKind:
        "journal",

      itemId,

      title:
        lineItem.title,

      quantity:
        lineItem.quantity,

      totalPages:
        productConfiguration
          .totalPages,

      manifestUrl:
        storedFiles
          .manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult
          .orderReference,

      cloudprinterItemReference:
        cloudprinterResult
          .itemReference,

      cloudprinterStatus:
        cloudprinterResult
          .status,
    };
  } finally {
    if (
      generatedFiles
        ?.interiorPath ||
      generatedFiles
        ?.coverPath
    ) {
      await deleteGeneratedLocalFiles({
        interiorPath:
          generatedFiles
            ?.interiorPath,

        coverPath:
          generatedFiles
            ?.coverPath,
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| Process notebook
|--------------------------------------------------------------------------
*/

async function processNotebookLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId =
    lineItem.id;

  let generatedFiles =
    null;

  try {
    console.log(
      `Starting NOTEBOOK PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateNotebookPDFs(
        order,
        lineItem
      );

    if (
      !generatedFiles
        ?.interiorPath ||
      !generatedFiles
        ?.coverPath
    ) {
      throw new Error(
        `Notebook PDF generation did not return both files for item ${itemId}`
      );
    }

    if (
      Number(
        generatedFiles
          .totalPages
      ) !==
      Number(
        productConfiguration
          .totalPages
      )
    ) {
      throw new Error(
        `Notebook item ${itemId} generated ${generatedFiles.totalPages} interior pages; expected ${productConfiguration.totalPages}`
      );
    }

    if (
      Number(
        generatedFiles
          .coverPages
      ) !==
      2
    ) {
      throw new Error(
        `Notebook item ${itemId} generated ${generatedFiles.coverPages} cover pages; expected 2`
      );
    }

    console.log(
      "===== NOTEBOOK PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      productKind:
        "notebook",

      sku:
        lineItem.sku,

      totalPages:
        generatedFiles
          .totalPages,

      coverPages:
        generatedFiles
          .coverPages,

      interiorPath:
        generatedFiles
          .interiorPath,

      coverPath:
        generatedFiles
          .coverPath,

      dimensions:
        generatedFiles
          .dimensions,
    });

    const uploadedFiles =
      await uploadGeneratedPDFs({
        interiorPath:
          generatedFiles
            .interiorPath,

        coverPath:
          generatedFiles
            .coverPath,

        orderId,

        itemId,
      });

    if (
      !uploadedFiles
        ?.interior
        ?.url ||
      !uploadedFiles
        ?.cover
        ?.url ||
      !uploadedFiles
        ?.interior
        ?.md5sum ||
      !uploadedFiles
        ?.cover
        ?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return complete notebook files for item ${itemId}`
      );
    }

    console.log(
      "===== NOTEBOOK CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      interiorUrl:
        uploadedFiles
          .interior
          .url,

      interiorMd5:
        uploadedFiles
          .interior
          .md5sum,

      coverUrl:
        uploadedFiles
          .cover
          .url,

      coverMd5:
        uploadedFiles
          .cover
          .md5sum,
    });

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,

        files: [
          uploadedFiles
            .interior,

          uploadedFiles
            .cover,
        ],
      });

    if (
      !storedFiles
        ?.manifestUrl
    ) {
      throw new Error(
        `The notebook file manifest was not saved correctly for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration
            .totalPages,

        productConfiguration,
      });

    if (
      !cloudprinterResult
        ?.success
    ) {
      throw new Error(
        `Cloudprinter did not confirm the notebook order for item ${itemId}`
      );
    }

    return {
      success:
        true,

      productKind:
        "notebook",

      itemId,

      title:
        lineItem.title,

      quantity:
        lineItem.quantity,

      totalPages:
        productConfiguration
          .totalPages,

      coverPages:
        generatedFiles
          .coverPages,

      manifestUrl:
        storedFiles
          .manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult
          .orderReference,

      cloudprinterItemReference:
        cloudprinterResult
          .itemReference,

      cloudprinterStatus:
        cloudprinterResult
          .status,
    };
  } finally {
    if (
      generatedFiles
        ?.interiorPath ||
      generatedFiles
        ?.coverPath
    ) {
      await deleteGeneratedLocalFiles({
        interiorPath:
          generatedFiles
            ?.interiorPath,

        coverPath:
          generatedFiles
            ?.coverPath,
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| Process calendar
|--------------------------------------------------------------------------
*/

async function processCalendarLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId =
    lineItem.id;

  let generatedFiles =
    null;

  try {
    console.log(
      `Starting CALENDAR PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateCalendarPDFs(
        order,
        lineItem
      );

    if (
      !generatedFiles
        ?.productPath
    ) {
      throw new Error(
        `Calendar PDF generation did not return productPath for item ${itemId}`
      );
    }

    if (
      Number(
        generatedFiles
          .totalPages
      ) !==
      Number(
        productConfiguration
          .totalPages
      )
    ) {
      throw new Error(
        `Calendar item ${itemId} generated ${generatedFiles.totalPages} pages; expected ${productConfiguration.totalPages}`
      );
    }

    console.log(
      "===== CALENDAR PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      productKind:
        "calendar",

      sku:
        lineItem.sku,

      totalPages:
        generatedFiles
          .totalPages,

      productPath:
        generatedFiles
          .productPath,

      dimensions:
        generatedFiles
          .dimensions,
    });

    const uploadedProduct =
      await uploadCalendarPdf({
        filePath:
          generatedFiles
            .productPath,

        orderId,

        itemId,
      });

    if (
      !uploadedProduct
        ?.url ||
      !uploadedProduct
        ?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return a complete calendar product file for item ${itemId}`
      );
    }

    const uploadedFiles = {
      product:
        uploadedProduct,
    };

    console.log(
      "===== CALENDAR CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,

      productUrl:
        uploadedProduct
          .url,

      productMd5:
        uploadedProduct
          .md5sum,
    });

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,

        files: [
          uploadedProduct,
        ],
      });

    if (
      !storedFiles
        ?.manifestUrl
    ) {
      throw new Error(
        `The calendar file manifest was not saved correctly for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration
            .totalPages,

        productConfiguration,
      });

    if (
      !cloudprinterResult
        ?.success
    ) {
      throw new Error(
        `Cloudprinter did not confirm the calendar order for item ${itemId}`
      );
    }

    return {
      success:
        true,

      productKind:
        "calendar",

      itemId,

      title:
        lineItem.title,

      quantity:
        lineItem.quantity,

      totalPages:
        productConfiguration
          .totalPages,

      manifestUrl:
        storedFiles
          .manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult
          .orderReference,

      cloudprinterItemReference:
        cloudprinterResult
          .itemReference,

      cloudprinterStatus:
        cloudprinterResult
          .status,
    };
  } finally {
    if (
      generatedFiles
        ?.productPath
    ) {
      await deleteCalendarLocalFile(
        generatedFiles
          .productPath
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| Resolve and process one line item
|--------------------------------------------------------------------------
*/

async function processLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  lineItemIndex,
  totalLineItems,
}) {
  const itemId =
    lineItem.id;

  console.log(
    `Starting line item ${
      lineItemIndex + 1
    } of ${totalLineItems}`
  );

  const productConfiguration =
    resolveProduct(
      lineItem
    );

  console.log({
    orderId,
    orderNumber,
    itemId,

    title:
      lineItem.title,

    variantTitle:
      lineItem
        .variant_title,

    sku:
      lineItem.sku,

    quantity:
      lineItem.quantity,

    resolvedProductKind:
      productConfiguration
        .kind,

    cloudprinterProductReference:
      productConfiguration
        .productReference,
  });

  try {
    if (
      productConfiguration
        .kind ===
      "calendar"
    ) {
      return await processCalendarLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    if (
      productConfiguration
        .kind ===
      "notebook"
    ) {
      return await processNotebookLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    if (
      productConfiguration
        .kind ===
      "journal"
    ) {
      return await processJournalLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    throw new Error(
      `Unsupported product kind: ${productConfiguration.kind}`
    );
  } catch (error) {
    console.error(
      `Processing failed for line item ${itemId}`
    );

    console.error({
      orderId,
      orderNumber,
      itemId,

      title:
        lineItem.title,

      sku:
        lineItem.sku,

      productKind:
        productConfiguration
          .kind,

      message:
        error.message,

      stack:
        error.stack,
    });

    return {
      success:
        false,

      productKind:
        productConfiguration
          .kind,

      itemId,

      title:
        lineItem.title,

      quantity:
        lineItem.quantity,

      error:
        error.message,
    };
  }
}

/*
|--------------------------------------------------------------------------
| Process complete Shopify order
|--------------------------------------------------------------------------
*/

async function processOrderInBackground(
  order
) {
  const orderId =
    order.id;

  const orderNumber =
    order.order_number ||
    order.id ||
    Date.now();

  const allLineItems =
    Array.isArray(
      order.line_items
    )
      ? order.line_items
      : [];

  const validLineItems =
    allLineItems.filter(
      isValidLineItem
    );

  if (
    validLineItems.length ===
    0
  ) {
    throw new Error(
      "The Shopify order does not contain any valid line items"
    );
  }

  console.log(
    "===== BACKGROUND ORDER PROCESSING STARTED ====="
  );

  console.log({
    orderId,
    orderNumber,

    totalLineItems:
      allLineItems.length,

    validLineItems:
      validLineItems.length,

    financialStatus:
      order.financial_status,
  });

  const results = [];

  /*
   * Process sequentially to avoid multiple large PDF generators
   * competing for Render memory at the same time.
   */

  for (
    let index = 0;
    index <
    validLineItems.length;
    index += 1
  ) {
    const lineItem =
      validLineItems[
        index
      ];

    const result =
      await processLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,

        lineItemIndex:
          index,

        totalLineItems:
          validLineItems
            .length,
      });

    results.push(
      result
    );
  }

  const successfulItems =
    results.filter(
      (
        result
      ) =>
        result.success
    );

  const failedItems =
    results.filter(
      (
        result
      ) =>
        !result.success
    );

  console.log(
    "===== ORDER PROCESSING SUMMARY ====="
  );

  console.log({
    orderId,
    orderNumber,

    totalItems:
      results.length,

    successfulItems:
      successfulItems
        .length,

    failedItems:
      failedItems.length,

    results,
  });

  if (
    failedItems.length >
    0
  ) {
    console.error(
      `Order ${orderNumber} completed with ${failedItems.length} failed line item(s)`
    );
  }

  if (
    successfulItems.length ===
    results.length
  ) {
    console.log(
      `✅ Order ${orderNumber} processing and Cloudprinter submission complete`
    );
  } else if (
    successfulItems.length >
    0
  ) {
    console.log(
      `⚠️ Order ${orderNumber} partially completed`
    );
  } else {
    console.error(
      `❌ Order ${orderNumber} failed completely`
    );
  }

  return {
    results,

    successfulItems,

    failedItems,

    allSucceeded:
      failedItems.length ===
      0,
  };
}

/*
|--------------------------------------------------------------------------
| POST /shopify/reprocess
|--------------------------------------------------------------------------
|
| Manually recovers an existing PAID Shopify order that was missed
| while Render/API was unavailable.
|
| It does NOT create a new Shopify order.
| It does NOT charge the customer.
|
*/

router.post(
  "/reprocess",

  express.json({
    limit:
      "1mb",
  }),

  async (
    req,
    res
  ) => {
    try {
      const expectedSecret =
        cleanString(
          process.env
            .ORDER_REPROCESS_SECRET
        );

      if (
        !expectedSecret
      ) {
        return res
          .status(
            500
          )
          .json({
            success:
              false,

            message:
              "ORDER_REPROCESS_SECRET is not configured in Render.",
          });
      }

      const suppliedSecret =
        cleanString(
          req.get(
            "X-Reprocess-Secret"
          )
        );

      if (
        !safeSecretEqual(
          suppliedSecret,
          expectedSecret
        )
      ) {
        return res
          .status(
            401
          )
          .json({
            success:
              false,

            message:
              "Unauthorized",
          });
      }

      const orderNumber =
        cleanString(
          req.body
            ?.orderNumber
        )
          .replace(
            /^#/,
            ""
          )
          .trim();

      if (
        !orderNumber
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            message:
              "orderNumber is required.",
          });
      }

      if (
        recoveryOrdersInProgress.has(
          orderNumber
        )
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            message:
              `Order #${orderNumber} is already being recovered.`,
          });
      }

      console.log(
        "========================================"
      );

      console.log(
        `MANUAL RECOVERY REQUESTED FOR ORDER #${orderNumber}`
      );

      console.log(
        "========================================"
      );

      const graphqlOrder =
        await findShopifyOrderForRecovery(
          orderNumber
        );

      if (
        !graphqlOrder
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            message:
              `Shopify order #${orderNumber} was not found.`,
          });
      }

      if (
        graphqlOrder
          .cancelledAt
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            message:
              `Order #${orderNumber} is cancelled in Shopify and will not be reprocessed.`,
          });
      }

      const financialStatus =
        cleanString(
          graphqlOrder
            .displayFinancialStatus
        ).toUpperCase();

      if (
        financialStatus !==
        "PAID"
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            message:
              `Order #${orderNumber} is not marked PAID in Shopify. Current status: ${
                financialStatus ||
                "UNKNOWN"
              }.`,
          });
      }

      const order =
        convertGraphqlOrder(
          graphqlOrder
        );

      console.log(
        "===== RECOVERED SHOPIFY ORDER ====="
      );

      console.log({
        orderId:
          order.id,

        orderNumber:
          order
            .order_number,

        orderName:
          order.name,

        email:
          order.email,

        financialStatus:
          order
            .financial_status,

        lineItems:
          order
            .line_items
            .length,

        hasShippingAddress:
          Boolean(
            order
              .shipping_address
          ),

        hasBillingAddress:
          Boolean(
            order
              .billing_address
          ),
      });

      order
        .line_items
        .forEach(
          (
            lineItem,
            index
          ) => {
            console.log(
              `Recovered product ${
                index + 1
              }:`,
              {
                id:
                  lineItem.id,

                title:
                  lineItem
                    .title,

                sku:
                  lineItem.sku,

                quantity:
                  lineItem
                    .quantity,

                variantTitle:
                  lineItem
                    .variant_title,

                propertyCount:
                  lineItem
                    .properties
                    .length,

                properties:
                  lineItem
                    .properties,
              }
            );
          }
        );

      /*
       * Prevent accidental duplicate production.
       */

      const existingFiles =
        await findExistingOrderFiles(
          order
        );

      if (
        existingFiles.length >
        0
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            message:
              "This order already has generated files. Recovery was stopped to prevent duplicate production.",

            existingItems:
              existingFiles.map(
                (
                  entry
                ) => ({
                  itemId:
                    entry
                      .itemId,

                  title:
                    entry
                      .title,
                })
              ),
          });
      }

      recoveryOrdersInProgress.add(
        orderNumber
      );

      /*
       * Respond first because PDF generation can take a while.
       */

      res
        .status(
          202
        )
        .json({
          success:
            true,

          message:
            `Order #${orderNumber} was found, verified as paid, and accepted for recovery.`,

          orderId:
            order.id,

          orderNumber:
            order
              .order_number,

          lineItemCount:
            order
              .line_items
              .length,

          nextStep:
            "Watch the Render logs for generation, Cloudinary upload, manifest creation and Cloudprinter submission.",
        });

      setImmediate(
        () => {
          processOrderInBackground(
            order
          )
            .then(
              (
                summary
              ) => {
                console.log(
                  "========================================"
                );

                if (
                  summary
                    .allSucceeded
                ) {
                  console.log(
                    `✅ MANUAL RECOVERY COMPLETE FOR ORDER #${orderNumber}`
                  );
                } else {
                  console.error(
                    `❌ MANUAL RECOVERY FINISHED WITH FAILURES FOR ORDER #${orderNumber}`
                  );

                  console.error({
                    failedItems:
                      summary
                        .failedItems,
                  });
                }

                console.log(
                  "========================================"
                );
              }
            )
            .catch(
              (
                error
              ) => {
                console.error(
                  "========================================"
                );

                console.error(
                  `❌ MANUAL RECOVERY FAILED FOR ORDER #${orderNumber}`
                );

                console.error({
                  message:
                    error
                      .message,

                  stack:
                    error
                      .stack,
                });

                console.error(
                  "========================================"
                );
              }
            )
            .finally(
              () => {
                recoveryOrdersInProgress.delete(
                  orderNumber
                );
              }
            );
        }
      );

      return;
    } catch (
      error
    ) {
      console.error(
        "Manual Shopify order recovery failed"
      );

      console.error({
        message:
          error.message,

        responseStatus:
          error
            .response
            ?.status,

        responseData:
          error
            .response
            ?.data,

        stack:
          error.stack,
      });

      if (
        !res.headersSent
      ) {
        return res
          .status(
            500
          )
          .json({
            success:
              false,

            message:
              error.message ||
              "Unable to recover Shopify order.",
          });
      }

      return;
    }
  }
);

/*
|--------------------------------------------------------------------------
| POST /shopify/order
|--------------------------------------------------------------------------
*/

router.post(
  "/order",

  express.raw({
    type:
      "application/json",
  }),

  async (
    req,
    res
  ) => {
    try {
      const shopifyHmac =
        req.get(
          "X-Shopify-Hmac-Sha256"
        );

      const webhookSecret =
        process.env
          .SHOPIFY_WEBHOOK_SECRET;

      if (
        !shopifyHmac
      ) {
        console.error(
          "Missing Shopify webhook HMAC header"
        );

        return res
          .status(
            401
          )
          .json({
            success:
              false,

            message:
              "Unauthorized",
          });
      }

      if (
        !webhookSecret
      ) {
        console.error(
          "SHOPIFY_WEBHOOK_SECRET is not configured"
        );

        return res
          .status(
            500
          )
          .json({
            success:
              false,

            message:
              "Webhook configuration error",
          });
      }

      if (
        !Buffer.isBuffer(
          req.body
        )
      ) {
        console.error(
          "Shopify webhook body is not a raw Buffer"
        );

        return res
          .status(
            400
          )
          .json({
            success:
              false,

            message:
              "Invalid webhook body",
          });
      }

      const isValid =
        verifyShopifyWebhook({
          rawBody:
            req.body,

          receivedHmac:
            shopifyHmac,

          webhookSecret,
        });

      if (
        !isValid
      ) {
        console.error(
          "Invalid Shopify webhook signature"
        );

        return res
          .status(
            401
          )
          .json({
            success:
              false,

            message:
              "Unauthorized",
          });
      }

      let order;

      try {
        order =
          JSON.parse(
            req.body.toString(
              "utf8"
            )
          );
      } catch (
        error
      ) {
        console.error(
          "Unable to parse Shopify webhook JSON"
        );

        console.error({
          message:
            error
              .message,

          stack:
            error
              .stack,
        });

        return res
          .status(
            400
          )
          .json({
            success:
              false,

            message:
              "Invalid JSON",
          });
      }

      if (
        !order?.id
      ) {
        console.error(
          "Shopify webhook does not contain an order ID"
        );

        return res
          .status(
            400
          )
          .json({
            success:
              false,

            message:
              "Invalid Shopify order",
          });
      }

      const orderId =
        order.id;

      const orderNumber =
        order.order_number ||
        order.id ||
        Date.now();

      const lineItems =
        Array.isArray(
          order.line_items
        )
          ? order
              .line_items
          : [];

      console.log(
        "✅ Verified Shopify order received"
      );

      console.log(
        "===== ORDER ====="
      );

      console.log({
        id:
          orderId,

        orderNumber,

        orderName:
          order.name,

        email:
          order.email,

        financialStatus:
          order
            .financial_status,

        fulfillmentStatus:
          order
            .fulfillment_status,

        createdAt:
          order
            .created_at,

        lineItemCount:
          lineItems
            .length,
      });

      console.log(
        "===== PRODUCTS ====="
      );

      lineItems.forEach(
        (
          item,
          index
        ) => {
          const productConfiguration =
            resolveProduct(
              item
            );

          console.log(
            `Product ${
              index + 1
            }:`,
            {
              lineItemId:
                item.id,

              productId:
                item
                  .product_id,

              variantId:
                item
                  .variant_id,

              title:
                item.title,

              variantTitle:
                item
                  .variant_title,

              quantity:
                item
                  .quantity,

              sku:
                item.sku,

              resolvedProductKind:
                productConfiguration
                  .kind,

              productReference:
                productConfiguration
                  .productReference,

              properties:
                item
                  .properties,
            }
          );
        }
      );

      /*
       * Respond to Shopify before generating the large PDFs.
       */

      res
        .status(
          200
        )
        .json({
          success:
            true,

          message:
            "Verified Shopify order accepted",

          orderId,

          orderNumber,

          lineItemCount:
            lineItems
              .length,
        });

      /*
       * Generate, upload and submit after Shopify receives its ACK.
       */

      setImmediate(
        () => {
          processOrderInBackground(
            order
          ).catch(
            (
              error
            ) => {
              console.error(
                "Background order processing failed"
              );

              console.error({
                orderId,
                orderNumber,

                message:
                  error
                    .message,

                stack:
                  error
                    .stack,
              });
            }
          );
        }
      );

      return;
    } catch (
      error
    ) {
      console.error(
        "Shopify webhook processing failed"
      );

      console.error({
        message:
          error.message,

        stack:
          error.stack,
      });

      if (
        !res.headersSent
      ) {
        return res
          .status(
            500
          )
          .json({
            success:
              false,

            message:
              "Order processing failed",
          });
      }

      return;
    }
  }
);

module.exports =
  router;