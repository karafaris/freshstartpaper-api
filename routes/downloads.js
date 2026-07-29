const express = require("express");
const axios = require("axios");

const {
  getOrderFiles,
} = require(
  "../services/orderFileStore"
);

const router =
  express.Router();

const SHOPIFY_API_VERSION =
  "2026-07";

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

function normalizeValue(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function normalizeKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
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

/*
|--------------------------------------------------------------------------
| Shopify IDs
|--------------------------------------------------------------------------
*/

function extractNumericIdFromGid(
  gid
) {
  const value =
    cleanString(gid);

  if (!value) {
    return null;
  }

  const parts =
    value.split("/");

  const numericId =
    parts[
      parts.length - 1
    ];

  if (
    !numericId ||
    !/^\d+$/.test(
      numericId
    )
  ) {
    return null;
  }

  return numericId;
}

/*
|--------------------------------------------------------------------------
| Shopify custom attributes
|--------------------------------------------------------------------------
*/

function customAttributesToObject(
  item
) {
  const result = {};

  const attributes =
    Array.isArray(
      item?.customAttributes
    )
      ? item.customAttributes
      : [];

  for (
    const attribute
    of attributes
  ) {
    const key =
      cleanString(
        attribute?.key
      );

    if (!key) {
      continue;
    }

    const value =
      cleanString(
        attribute?.value
      );

    result[key] = value;
    result[
      normalizeKey(key)
    ] = value;
  }

  return result;
}

function getItemProperty(
  item,
  names,
  fallback = ""
) {
  const properties =
    customAttributesToObject(
      item
    );

  for (
    const name
    of names
  ) {
    const directValue =
      cleanString(
        properties[name]
      );

    if (directValue) {
      return directValue;
    }

    const normalizedValue =
      cleanString(
        properties[
          normalizeKey(name)
        ]
      );

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return fallback;
}

/*
|--------------------------------------------------------------------------
| Shopify errors
|--------------------------------------------------------------------------
*/

function getShopifyErrorDetails(
  error
) {
  const status =
    error.response?.status ||
    null;

  const data =
    error.response?.data ||
    null;

  let shopifyMessage = "";

  if (
    typeof data ===
    "string"
  ) {
    shopifyMessage =
      data;
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
| Shopify token
|--------------------------------------------------------------------------
*/

async function getShopifyAccessToken() {
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

        timeout: 15000,
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
      "Shopify responded without an access token."
    );
  }

  cachedAccessToken =
    accessToken;

  cachedAccessTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresInSeconds -
        300,
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
| Find Shopify order
|--------------------------------------------------------------------------
*/

async function findShopifyOrder(
  orderNumber
) {
  const shopifyStore =
    normalizeShopifyStore(
      process.env
        .SHOPIFY_STORE
    );

  const accessToken =
    await getShopifyAccessToken();

  const graphqlUrl =
    `https://${shopifyStore}` +
    `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  /*
   * customAttributes contains Shopify line-item properties.
   * Those properties identify journals, notebooks and calendars.
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

  const searchQuery =
    `name:#${orderNumber}`;

  console.log(
    "Searching Shopify for:",
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

        timeout: 15000,
      }
    );

  if (
    Array.isArray(
      response.data?.errors
    ) &&
    response.data.errors
      .length > 0
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
    response.data
      ?.data
      ?.orders
      ?.nodes;

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
    cleanString(
      orderNumber
    )
      .replace(/^#/, "")
      .trim();

  return (
    orders.find(
      (order) => {
        const orderName =
          cleanString(
            order.name
          )
            .replace(
              /^#/,
              ""
            )
            .trim();

        return (
          orderName ===
          requestedNumber
        );
      }
    ) || null
  );
}

/*
|--------------------------------------------------------------------------
| Product detection
|--------------------------------------------------------------------------
*/

function createItemSearchText(
  item
) {
  const properties =
    customAttributesToObject(
      item
    );

  return [
    item?.title,
    item?.name,
    item?.sku,
    item?.variantTitle,

    ...Object.keys(
      properties
    ),

    ...Object.values(
      properties
    ),
  ]
    .map(cleanString)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function detectProductKindFromItem(
  item
) {
  const searchText =
    createItemSearchText(
      item
    );

  const productCode =
    getItemProperty(
      item,
      [
        "Print product code",
        "Product code",
        "Cloudprinter product code",
        "API reference",
      ]
    ).toLowerCase();

  const generatorKind =
    getItemProperty(
      item,
      [
        "_Generator kind",
        "Generator kind",
        "Product kind",
      ]
    ).toLowerCase();

  const customizationVersion =
    getItemProperty(
      item,
      [
        "_Customization version",
        "Customization version",
      ]
    ).toLowerCase();

  /*
   * Notebook must be checked before journal because both
   * products contain an interior/book file and a cover file.
   */

  if (
    generatorKind ===
      "notebook" ||
    productCode.includes(
      "textbook_co_a3_l_fc_ink"
    ) ||
    customizationVersion.includes(
      "notebook"
    ) ||
    getItemProperty(
      item,
      ["Notebook title"]
    ) ||
    searchText.includes(
      "textbook_co_a3_l_fc_ink"
    ) ||
    /\bnotebook\b/.test(
      searchText
    ) ||
    /\bnotepads?\b/.test(
      searchText
    )
  ) {
    return "notebook";
  }

  if (
    generatorKind ===
      "calendar" ||
    productCode.includes(
      "calendar_wall_int_a5_l_double_fc_tnr"
    ) ||
    customizationVersion.includes(
      "calendar"
    ) ||
    getItemProperty(
      item,
      ["Calendar title"]
    ) ||
    searchText.includes(
      "calendar_wall_int_a5_l_double_fc_tnr"
    ) ||
    /\bcalendar\b/.test(
      searchText
    )
  ) {
    return "calendar";
  }

  if (
    generatorKind ===
      "journal" ||
    productCode.includes(
      "textbook_pb_1025x6630_l_fc_ink"
    ) ||
    customizationVersion.includes(
      "journal"
    ) ||
    getItemProperty(
      item,
      ["Journal title"]
    ) ||
    /\bjournal\b/.test(
      searchText
    )
  ) {
    return "journal";
  }

  return null;
}

function resolveDownloadProductKind({
  item,
  manifest,
  primaryFile,
  coverFile,
}) {
  const manifestProductKind =
    normalizeValue(
      manifest?.productKind ||
        manifest?.product_kind ||
        manifest?.kind
    );

  if (
    [
      "journal",
      "notebook",
      "calendar",
    ].includes(
      manifestProductKind
    )
  ) {
    return manifestProductKind;
  }

  const detectedKind =
    detectProductKindFromItem(
      item
    );

  if (detectedKind) {
    return detectedKind;
  }

  /*
   * A single file with no cover is the calendar fallback.
   */

  if (
    primaryFile &&
    !coverFile
  ) {
    return "calendar";
  }

  /*
   * Legacy manifests containing an interior and cover were
   * historically journals.
   */

  return "journal";
}

/*
|--------------------------------------------------------------------------
| Manifest file helpers
|--------------------------------------------------------------------------
*/

function normalizeManifestFiles(
  manifest
) {
  return Array.isArray(
    manifest?.files
  )
    ? manifest.files.filter(
        Boolean
      )
    : [];
}

function findPrimaryFile(files) {
  return (
    files.find(
      (file) =>
        file.type ===
        "product"
    ) ||

    files.find(
      (file) =>
        file.type ===
        "book"
    ) ||

    files.find(
      (file) =>
        file.type ===
        "interior"
    ) ||

    files.find(
      (file) =>
        file.type ===
        "calendar"
    ) ||

    files.find(
      (file) =>
        file.type ===
        "journal"
    ) ||

    null
  );
}

function findCoverFile(files) {
  return (
    files.find(
      (file) =>
        file.type ===
        "cover"
    ) ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| Product display names
|--------------------------------------------------------------------------
*/

function getCustomizedProductName(
  item,
  productKind
) {
  if (
    productKind ===
    "notebook"
  ) {
    return (
      getItemProperty(
        item,
        ["Notebook title"]
      ) ||
      item.title ||
      item.name ||
      "Custom Notebook"
    );
  }

  if (
    productKind ===
    "calendar"
  ) {
    return (
      getItemProperty(
        item,
        ["Calendar title"]
      ) ||
      item.title ||
      item.name ||
      "Custom Calendar"
    );
  }

  return (
    getItemProperty(
      item,
      ["Journal title"]
    ) ||
    item.title ||
    item.name ||
    "Custom Journal"
  );
}

/*
|--------------------------------------------------------------------------
| Build download results
|--------------------------------------------------------------------------
*/

function buildDownloadResult({
  item,
  itemId,
  manifest,
  productKind,
}) {
  const files =
    normalizeManifestFiles(
      manifest
    );

  const primaryFile =
    findPrimaryFile(files);

  const coverFile =
    findCoverFile(files);

  if (
    !primaryFile?.url &&
    !coverFile?.url
  ) {
    return null;
  }

  const product =
    getCustomizedProductName(
      item,
      productKind
    );

  const baseResult = {
    product,
    productKind,
    itemId,

    sku:
      item.sku || null,

    quantity:
      item.quantity || 1,

    primaryFile:
      primaryFile || null,

    coverFile:
      coverFile || null,

    manifestUrl:
      manifest.manifestUrl ||
      manifest.manifest_url ||
      null,
  };

  if (
    productKind ===
    "calendar"
  ) {
    return {
      ...baseResult,

      calendar:
        primaryFile,

      journal:
        null,

      notebook:
        null,

      cover:
        null,

      files: {
        primary:
          primaryFile,

        calendar:
          primaryFile,

        journal:
          null,

        notebook:
          null,

        cover:
          null,
      },
    };
  }

  if (
    productKind ===
    "notebook"
  ) {
    return {
      ...baseResult,

      calendar:
        null,

      journal:
        null,

      notebook:
        primaryFile,

      cover:
        coverFile,

      files: {
        primary:
          primaryFile,

        calendar:
          null,

        journal:
          null,

        notebook:
          primaryFile,

        cover:
          coverFile,
      },
    };
  }

  return {
    ...baseResult,

    calendar:
      null,

    journal:
      primaryFile,

    notebook:
      null,

    cover:
      coverFile,

    files: {
      primary:
        primaryFile,

      calendar:
        null,

      journal:
        primaryFile,

      notebook:
        null,

      cover:
        coverFile,
    },
  };
}

/*
|--------------------------------------------------------------------------
| GET /downloads
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  (req, res) => {
    return res
      .status(200)
      .json({
        success: true,

        message:
          "Downloads route is working.",

        supportedProducts: [
          "journal",
          "notebook",
          "calendar",
        ],

        timestamp:
          new Date()
            .toISOString(),
      });
  }
);

/*
|--------------------------------------------------------------------------
| POST /downloads
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  async (req, res) => {
    try {
      const orderNumber =
        cleanString(
          req.body
            ?.orderNumber
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
        order.lineItems
          ?.nodes;

      if (
        !Array.isArray(
          lineItems
        )
      ) {
        throw new Error(
          "Shopify did not return the order line items."
        );
      }

      console.log(
        `Found order ${order.name} with ${lineItems.length} line item(s).`
      );

      const downloads = [];

      for (
        const item
        of lineItems
      ) {
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

          const files =
            normalizeManifestFiles(
              manifest
            );

          const primaryFile =
            findPrimaryFile(
              files
            );

          const coverFile =
            findCoverFile(
              files
            );

          const productKind =
            resolveDownloadProductKind({
              item,
              manifest,
              primaryFile,
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

            customAttributes:
              item.customAttributes,

            manifestProductKind:
              manifest.productKind ||
              null,

            manifestFileTypes:
              files.map(
                (file) =>
                  file.type
              ),
          });

          const download =
            buildDownloadResult({
              item,
              itemId,
              manifest,
              productKind,
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
        } catch (
          manifestError
        ) {
          console.error(
            `Manifest error for item ${itemId}:`,
            manifestError.message
          );
        }
      }

      if (
        downloads.length ===
        0
      ) {
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

      if (
        [400, 401, 403]
          .includes(status)
      ) {
        return res
          .status(500)
          .json({
            success: false,

            message:
              shopifyMessage ||
              "Shopify rejected the downloads request.",
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
  }
);

module.exports = router;