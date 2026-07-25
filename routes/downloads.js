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
| Dev Dashboard client-credentials tokens expire after approximately
| 24 hours. We cache the token and request a new one shortly before expiry.
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
| Get Shopify Admin API access token
|--------------------------------------------------------------------------
*/

async function getShopifyAccessToken() {
  const shopifyStore = normalizeShopifyStore(
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
   * Reuse the token while it remains valid.
   * Refresh five minutes before Shopify says it expires.
   */
  if (
    cachedAccessToken &&
    cachedAccessTokenExpiresAt > now + 5 * 60 * 1000
  ) {
    return cachedAccessToken;
  }

  const tokenUrl =
    `https://${shopifyStore}` +
    "/admin/oauth/access_token";

  const requestBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  console.log(
    "Requesting Shopify Admin API access token"
  );

  const response = await axios.post(
    tokenUrl,
    requestBody.toString(),
    {
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    }
  );

  const accessToken =
    response.data?.access_token;

  const expiresInSeconds = Number(
    response.data?.expires_in || 86399
  );

  if (!accessToken) {
    throw new Error(
      "Shopify did not return an access token."
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
    "Shopify Admin API access token acquired"
  );

  return cachedAccessToken;
}

/*
|--------------------------------------------------------------------------
| Find a Shopify order
|--------------------------------------------------------------------------
*/

async function findShopifyOrder(orderNumber) {
  const shopifyStore = normalizeShopifyStore(
    process.env.SHOPIFY_STORE
  );

  const accessToken =
    await getShopifyAccessToken();

  const graphqlUrl =
    `https://${shopifyStore}` +
    `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

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
          contactEmail
          lineItems(first: 100) {
            nodes {
              id
              legacyResourceId
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
      },
      timeout: 15000,
    }
  );

  if (
    Array.isArray(response.data?.errors) &&
    response.data.errors.length > 0
  ) {
    throw new Error(
      response.data.errors
        .map((error) => error.message)
        .join("; ")
    );
  }

  const orders =
    response.data?.data?.orders?.nodes;

  if (!Array.isArray(orders)) {
    return null;
  }

  const normalizedRequestedNumber =
    String(orderNumber)
      .replace(/^#/, "")
      .trim();

  return (
    orders.find((order) => {
      const normalizedOrderName =
        String(order.name || "")
          .replace(/^#/, "")
          .trim();

      return (
        normalizedOrderName ===
        normalizedRequestedNumber
      );
    }) || null
  );
}

/*
|--------------------------------------------------------------------------
| GET /downloads
|--------------------------------------------------------------------------
| Confirms that the route is deployed.
|--------------------------------------------------------------------------
*/

router.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message:
      "Downloads route is working.",
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| POST /downloads
|--------------------------------------------------------------------------
| Verifies the customer's order number and email, then returns the
| generated Cloudinary PDF files stored in the order manifest.
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

    if (!orderNumber || !submittedEmail) {
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
      await findShopifyOrder(orderNumber);

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Order not found. Enter the Shopify order number, such as 1017.",
      });
    }

    const orderEmail = String(
      order.email ||
        order.contactEmail ||
        ""
    )
      .trim()
      .toLowerCase();

    if (
      !orderEmail ||
      orderEmail !== submittedEmail
    ) {
      return res.status(403).json({
        success: false,
        message:
          "The order number and email address do not match.",
      });
    }

    const orderId =
      order.legacyResourceId;

    if (!orderId) {
      throw new Error(
        "Shopify order did not include a legacy order ID."
      );
    }

    const lineItems =
      order.lineItems?.nodes;

    if (!Array.isArray(lineItems)) {
      throw new Error(
        "Shopify order did not include line items."
      );
    }

    const downloads = [];

    for (const item of lineItems) {
      const itemId =
        item.legacyResourceId;

      if (!itemId) {
        console.log(
          `Skipping line item without legacy ID: ${item.id}`
        );

        continue;
      }

      try {
        const manifest =
          await getOrderFiles({
            orderId,
            itemId,
          });

        if (
          !manifest ||
          !Array.isArray(manifest.files)
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
            `Manifest contains no downloadable files for item ${itemId}`
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
          `Manifest lookup failed for item ${itemId}`
        );

        console.error({
          message:
            manifestError.message,
          stack:
            manifestError.stack,
        });
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
      orderNumber: order.name,
      downloads,
    });
  } catch (error) {
    const shopifyStatus =
      error.response?.status;

    const shopifyData =
      error.response?.data;

    console.error(
      "Downloads route failed"
    );

    console.error({
      message: error.message,
      status: shopifyStatus,
      response: shopifyData,
      stack: error.stack,
    });

    if (
      shopifyStatus === 400 ||
      shopifyStatus === 401
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Shopify authentication failed. Confirm that the app is installed and the Client ID and Client secret are correct.",
      });
    }

    if (shopifyStatus === 403) {
      return res.status(500).json({
        success: false,
        message:
          "Shopify denied order access. Add the read_orders scope, release the app version, and reinstall or update the app.",
      });
    }

    if (
      error.message.includes(
        "SHOPIFY_"
      )
    ) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve downloads.",
    });
  }
});

module.exports = router;