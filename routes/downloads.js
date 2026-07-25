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
| Normalize Shopify store domain
|--------------------------------------------------------------------------
*/

function normalizeShopifyStore(store) {
  return String(store || "")
    .trim()
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
  const value = String(gid || "").trim();

  if (!value) {
    return null;
  }

  const parts = value.split("/");
  const numericId = parts[parts.length - 1];

  if (!numericId || !/^\d+$/.test(numericId)) {
    return null;
  }

  return numericId;
}

/*
|--------------------------------------------------------------------------
| Extract Shopify error details
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
| Get Shopify Admin API access token
|--------------------------------------------------------------------------
*/

async function getShopifyAccessToken() {
  const shopifyStore =
    normalizeShopifyStore(
      process.env.SHOPIFY_STORE
    );

  const clientId = String(
    process.env.SHOPIFY_CLIENT_ID || ""
  ).trim();

  const clientSecret = String(
    process.env.SHOPIFY_CLIENT_SECRET || ""
  ).trim();

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
   * Reuse the current access token while it remains valid.
   * Request a replacement shortly before expiration.
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
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

  console.log(
    "Requesting Shopify token from:",
    tokenUrl
  );

  const response = await axios.post(
    tokenUrl,
    requestBody.toString(),
    {
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json",
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

  cachedAccessToken = accessToken;

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
| Find Shopify order
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
   * We intentionally query order.email directly.
   *
   * Do not add customer { email } here. Accessing the Customer object
   * requires the additional read_customers scope, which this app does
   * not need for the download lookup.
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
              quantity
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
        Accept: "application/json",
      },
      timeout: 15000,
    }
  );

  if (
    Array.isArray(response.data?.errors) &&
    response.data.errors.length > 0
  ) {
    const graphqlMessage =
      response.data.errors
        .map(
          (graphqlError) =>
            graphqlError.message
        )
        .join("; ");

    throw new Error(graphqlMessage);
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
    String(orderNumber)
      .replace(/^#/, "")
      .trim();

  return (
    orders.find((order) => {
      const orderName =
        String(order.name || "")
          .replace(/^#/, "")
          .trim();

      return (
        orderName === requestedNumber
      );
    }) || null
  );
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
    const orderNumber = String(
      req.body?.orderNumber || ""
    )
      .replace(/^#/, "")
      .trim();

    const submittedEmail = String(
      req.body?.email || ""
    )
      .trim()
      .toLowerCase();

    if (
      !orderNumber ||
      !submittedEmail
    ) {
      return res.status(400).json({
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
      return res.status(404).json({
        success: false,
        message:
          "Order not found. Enter the Shopify order number, such as 1017.",
      });
    }

    const orderEmail = String(
      order.email || ""
    )
      .trim()
      .toLowerCase();

    if (!orderEmail) {
      return res.status(403).json({
        success: false,
        message:
          "No email address was found on this order.",
      });
    }

    if (
      orderEmail !== submittedEmail
    ) {
      return res.status(403).json({
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

        const journal =
          manifest.files.find(
            (file) =>
              file.type === "product" ||
              file.type === "journal" ||
              file.type === "interior"
          ) || null;

        const cover =
          manifest.files.find(
            (file) =>
              file.type === "cover"
          ) || null;

        if (!journal && !cover) {
          console.log(
            `Manifest contains no journal or cover for item ${itemId}`
          );

          continue;
        }

        downloads.push({
          product:
            item.title ||
            "Custom Journal",
          itemId,
          quantity:
            item.quantity || 1,
          journal,
          cover,
        });
      } catch (manifestError) {
        console.error(
          `Manifest error for item ${itemId}:`,
          manifestError.message
        );
      }
    }

    if (downloads.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Your journal files were not found or are still being generated.",
      });
    }

    return res.status(200).json({
      success: true,
      orderNumber:
        order.name,
      downloads,
    });
  } catch (error) {
    const {
      status,
      shopifyMessage,
    } = getShopifyErrorDetails(error);

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
      return res.status(500).json({
        success: false,
        message:
          shopifyMessage ||
          "Shopify rejected the request with status 400.",
      });
    }

    if (status === 401) {
      return res.status(500).json({
        success: false,
        message:
          shopifyMessage ||
          "Shopify rejected the Client ID or Client secret.",
      });
    }

    if (status === 403) {
      return res.status(500).json({
        success: false,
        message:
          shopifyMessage ||
          "Shopify denied access to the order.",
      });
    }

    if (
      String(error.message).includes(
        "SHOPIFY_"
      )
    ) {
      return res.status(500).json({
        success: false,
        message:
          error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        shopifyMessage ||
        error.message ||
        "Unable to retrieve downloads.",
    });
  }
});

module.exports = router;