const express = require("express");
const axios = require("axios");

const {
  getOrderFiles,
} = require("../services/orderFileStore");

const router = express.Router();

const SHOPIFY_API_VERSION = "2026-07";

/*
|--------------------------------------------------------------------------
| Shopify access-token cache
|--------------------------------------------------------------------------
*/

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
*/

function cleanString(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const cleaned = String(value).trim();

  return cleaned || fallback;
}

function normalizeValue(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeShopifyStore(store) {
  return cleanString(store)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/*
|--------------------------------------------------------------------------
| Extract numeric ID from Shopify GraphQL GID
|--------------------------------------------------------------------------
|
| Example:
| gid://shopify/LineItem/123456789
|
| Returns:
| 123456789
|--------------------------------------------------------------------------
*/

function extractNumericIdFromGid(gid) {
  const value = cleanString(gid);

  if (!value) {
    return null;
  }

  const parts = value.split("/");
  const numericId = parts[parts.length - 1];

  if (
    !numericId ||
    !/^\d+$/.test(numericId)
  ) {
    return null;
  }

  return numericId;
}

/*
|--------------------------------------------------------------------------
| Shopify error helper
|--------------------------------------------------------------------------
*/

function getShopifyErrorDetails(error) {
  const status =
    error.response?.status || null;

  const data =
    error.response?.data || null;

  let shopifyMessage = "";

  if (typeof data === "string") {
    shopifyMessage = data;
  } else if (data) {
    shopifyMessage =
      data.error_description ||
      data.error ||
      data.message ||
      JSON.stringify(data);
  }

  return {
    status,
    shopifyMessage,
  };
}

/*
|--------------------------------------------------------------------------
| Shopify access token
|--------------------------------------------------------------------------
*/

async function getShopifyAccessToken() {
  const shopifyStore =
    normalizeShopifyStore(
      process.env.SHOPIFY_STORE
    );

  const clientId =
    cleanString(
      process.env.SHOPIFY_CLIENT_ID
    );

  const clientSecret =
    cleanString(
      process.env.SHOPIFY_CLIENT_SECRET
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

  const now = Date.now();

  /*
   * Reuse the existing access token until shortly before
   * its expiration time.
   */
  if (
    cachedAccessToken &&
    cachedAccessTokenExpiresAt >
      now + 5 * 60 * 1000
  ) {
    return cachedAccessToken;
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
    "Requesting Shopify access token."
  );

  const response = await axios.post(
    tokenUrl,
    requestBody.toString(),
    {
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept:
          "application/json",
      },
      timeout: 15000,
    }
  );

  const accessToken =
    response.data?.access_token;

  const expiresInSeconds =
    Number(
      response.data?.expires_in ||
      86399
    );

  if (!accessToken) {
    throw new Error(
      "Shopify responded without an access token."
    );
  }

  cachedAccessToken =
    accessToken;

  cachedAccessTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresInSeconds - 300,
      60
    ) *
      1000;

  console.log(
    "Shopify Admin API access token acquired."
  );

  return cachedAccessToken;
}

/*
|--------------------------------------------------------------------------
| Find the Shopify order
|--------------------------------------------------------------------------
*/

async function findShopifyOrder(
  orderNumber
) {
  const shopifyStore =
    normalizeShopifyStore(
      process.env.SHOPIFY_STORE
    );

  const accessToken =
    await getShopifyAccessToken();

  const graphqlUrl =
    `https://${shopifyStore}` +
    `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  /*
   * SKU is included so calendar items can be identified using:
   *
   * CUSTOM-CALENDAR
   */
  const query = `
    query FindOrder($searchQuery: String!) {
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
          lineItems(first: 100) {
            nodes {
              id
              title
              name
              quantity
              sku
              variantTitle
            }
          }
        }
      }
    }
  `;

  const searchQuery =
    `name:#${orderNumber}`;

  console.log(
    "Searching Shopify for:",
    searchQuery
  );

  const response = await axios.post(
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
      timeout: 15000,
    }
  );

  if (
    Array.isArray(
      response.data?.errors
    ) &&
    response.data.errors.length > 0
  ) {
    const graphqlMessage =
      response.data.errors
        .map(
          (graphqlError) =>
            graphqlError.message
        )
        .join("; ");

    throw new Error(
      graphqlMessage
    );
  }

  const orders =
    response.data?.data?.orders?.nodes;

  if (!Array.isArray(orders)) {
    console.error(
      "Shopify did not return an orders array:",
      JSON.stringify(
        response.data || {},
        null,
        2
      )
    );

    return null;
  }

  const requestedNumber =
    cleanString(orderNumber)
      .replace(/^#/, "")
      .trim();

  return (
    orders.find((order) => {
      const orderName =
        cleanString(order.name)
          .replace(/^#/, "")
          .trim();

      return (
        orderName ===
        requestedNumber
      );
    }) || null
  );
}

/*
|--------------------------------------------------------------------------
| Product detection
|--------------------------------------------------------------------------
*/

/**
 * Return all calendar SKUs configured in Render.
 *
 * Expected:
 * CALENDAR_SHOPIFY_SKUS=CUSTOM-CALENDAR
 */
function getConfiguredCalendarSkus() {
  return cleanString(
    process.env.CALENDAR_SHOPIFY_SKUS,
    "CUSTOM-CALENDAR"
  )
    .split(",")
    .map(normalizeValue)
    .filter(Boolean);
}

/**
 * Detect whether a Shopify item is a calendar.
 */
function isCalendarShopifyItem(item) {
  const itemSku =
    normalizeValue(item?.sku);

  const calendarSkus =
    getConfiguredCalendarSkus();

  if (
    itemSku &&
    calendarSkus.includes(itemSku)
  ) {
    return true;
  }

  const searchableText = [
    item?.title,
    item?.name,
    item?.variantTitle,
  ]
    .map(normalizeValue)
    .filter(Boolean)
    .join(" ");

  return searchableText.includes(
    "calendar"
  );
}

/**
 * Detect the product kind from the manifest and Shopify item.
 *
 * This supports:
 *
 * 1. New manifests that may include productKind
 * 2. Shopify SKU detection
 * 3. Existing manifests where:
 *    - calendar = one product file and no cover
 *    - journal = interior/product file plus cover
 */
function resolveDownloadProductKind({
  item,
  manifest,
  productFile,
  coverFile,
}) {
  const manifestProductKind =
    normalizeValue(
      manifest?.productKind ||
      manifest?.product_kind ||
      manifest?.kind
    );

  if (
    manifestProductKind ===
    "calendar"
  ) {
    return "calendar";
  }

  if (
    manifestProductKind ===
    "journal"
  ) {
    return "journal";
  }

  if (
    isCalendarShopifyItem(item)
  ) {
    return "calendar";
  }

  if (
    productFile &&
    !coverFile
  ) {
    return "calendar";
  }

  return "journal";
}

/*
|--------------------------------------------------------------------------
| Manifest file helpers
|--------------------------------------------------------------------------
*/

function findProductFile(files) {
  return (
    files.find(
      (file) =>
        file.type === "product"
    ) ||
    files.find(
      (file) =>
        file.type === "calendar"
    ) ||
    files.find(
      (file) =>
        file.type === "journal"
    ) ||
    files.find(
      (file) =>
        file.type === "interior"
    ) ||
    null
  );
}

function findInteriorFile(files) {
  return (
    files.find(
      (file) =>
        file.type === "interior"
    ) ||
    files.find(
      (file) =>
        file.type === "journal"
    ) ||
    files.find(
      (file) =>
        file.type === "product"
    ) ||
    null
  );
}

function findCoverFile(files) {
  return (
    files.find(
      (file) =>
        file.type === "cover"
    ) || null
  );
}

/*
|--------------------------------------------------------------------------
| Build one calendar download result
|--------------------------------------------------------------------------
*/

function buildCalendarDownload({
  item,
  itemId,
  manifest,
}) {
  const files =
    Array.isArray(manifest.files)
      ? manifest.files
      : [];

  const calendar =
    findProductFile(files);

  if (!calendar?.url) {
    return null;
  }

  return {
    product:
      item.title ||
      item.name ||
      "Custom Calendar",

    productKind:
      "calendar",

    itemId,

    sku:
      item.sku || null,

    quantity:
      item.quantity || 1,

    calendar,

    journal: null,

    cover: null,

    files: {
      calendar,
      journal: null,
      cover: null,
    },

    manifestUrl:
      manifest.manifestUrl ||
      manifest.manifest_url ||
      null,
  };
}

/*
|--------------------------------------------------------------------------
| Build one journal download result
|--------------------------------------------------------------------------
*/

function buildJournalDownload({
  item,
  itemId,
  manifest,
}) {
  const files =
    Array.isArray(manifest.files)
      ? manifest.files
      : [];

  const journal =
    findInteriorFile(files);

  const cover =
    findCoverFile(files);

  if (
    !journal?.url &&
    !cover?.url
  ) {
    return null;
  }

  return {
    product:
      item.title ||
      item.name ||
      "Custom Journal",

    productKind:
      "journal",

    itemId,

    sku:
      item.sku || null,

    quantity:
      item.quantity || 1,

    calendar: null,

    journal,

    cover,

    files: {
      calendar: null,
      journal,
      cover,
    },

    manifestUrl:
      manifest.manifestUrl ||
      manifest.manifest_url ||
      null,
  };
}

/*
|--------------------------------------------------------------------------
| GET /downloads
|--------------------------------------------------------------------------
*/

router.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message:
      "Downloads route is working.",
    supportedProducts: [
      "journal",
      "calendar",
    ],
    timestamp:
      new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| POST /downloads
|--------------------------------------------------------------------------
*/

router.post("/", async (req, res) => {
  try {
    const orderNumber =
      cleanString(
        req.body?.orderNumber
      )
        .replace(/^#/, "")
        .trim();

    const submittedEmail =
      cleanString(
        req.body?.email
      ).toLowerCase();

    if (
      !orderNumber ||
      !submittedEmail
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Order number and email are required.",
        });
    }

    console.log(
      `Looking up Shopify order #${orderNumber}`
    );

    const order =
      await findShopifyOrder(
        orderNumber
      );

    if (!order) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Order not found. Enter the Shopify order number, such as 1017.",
        });
    }

    const orderEmail =
      cleanString(
        order.email
      ).toLowerCase();

    if (!orderEmail) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "No email address was found on this order.",
        });
    }

    if (
      orderEmail !==
      submittedEmail
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "The order number and email address do not match.",
        });
    }

    const orderId =
      order.legacyResourceId ||
      extractNumericIdFromGid(
        order.id
      );

    if (!orderId) {
      throw new Error(
        "Shopify did not return a usable internal order ID."
      );
    }

    const lineItems =
      order.lineItems?.nodes;

    if (!Array.isArray(lineItems)) {
      throw new Error(
        "Shopify did not return the order line items."
      );
    }

    console.log(
      `Found order ${order.name} with ${lineItems.length} line item(s).`
    );

    const downloads = [];

    for (const item of lineItems) {
      const itemId =
        extractNumericIdFromGid(
          item.id
        );

      if (!itemId) {
        console.error(
          "Unable to extract numeric line-item ID:",
          item.id
        );

        continue;
      }

      try {
        console.log(
          `Looking for manifest: order ${orderId}, item ${itemId}`
        );

        const manifest =
          await getOrderFiles({
            orderId,
            itemId,
          });

        if (
          !manifest ||
          !Array.isArray(
            manifest.files
          )
        ) {
          console.log(
            `No manifest found for order ${orderId}, item ${itemId}`
          );

          continue;
        }

        const productFile =
          findProductFile(
            manifest.files
          );

        const coverFile =
          findCoverFile(
            manifest.files
          );

        const productKind =
          resolveDownloadProductKind({
            item,
            manifest,
            productFile,
            coverFile,
          });

        console.log(
          "===== DOWNLOAD PRODUCT RESOLUTION ====="
        );

        console.log({
          orderId,
          itemId,
          title:
            item.title,
          sku:
            item.sku,
          productKind,
          manifestFileTypes:
            manifest.files.map(
              (file) =>
                file.type
            ),
        });

        const download =
          productKind ===
          "calendar"
            ? buildCalendarDownload({
                item,
                itemId,
                manifest,
              })
            : buildJournalDownload({
                item,
                itemId,
                manifest,
              });

        if (!download) {
          console.log(
            `Manifest does not contain usable ${productKind} files for item ${itemId}`
          );

          continue;
        }

        downloads.push(
          download
        );
      } catch (manifestError) {
        console.error(
          `Manifest error for item ${itemId}:`,
          manifestError.message
        );
      }
    }

    if (downloads.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Your files were not found or are still being generated.",
        });
    }

    const productKinds = [
      ...new Set(
        downloads.map(
          (download) =>
            download.productKind
        )
      ),
    ];

    return res
      .status(200)
      .json({
        success: true,
        orderNumber:
          order.name,
        productKinds,
        downloads,
      });
  } catch (error) {
    const {
      status,
      shopifyMessage,
    } =
      getShopifyErrorDetails(
        error
      );

    console.error(
      "Downloads request failed:",
      {
        status,
        message:
          error.message,
        shopifyMessage,
        stack:
          error.stack,
      }
    );

    if (status === 400) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            shopifyMessage ||
            "Shopify rejected the request with status 400.",
        });
    }

    if (status === 401) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            shopifyMessage ||
            "Shopify rejected the Client ID or Client secret.",
        });
    }

    if (status === 403) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            shopifyMessage ||
            "Shopify denied access to the order.",
        });
    }

    if (
      String(
        error.message
      ).includes(
        "SHOPIFY_"
      )
    ) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });
    }

    return res
      .status(500)
      .json({
        success: false,
        message:
          shopifyMessage ||
          error.message ||
          "Unable to retrieve downloads.",
      });
  }
});

module.exports = router;