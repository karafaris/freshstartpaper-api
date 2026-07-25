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
| Log Axios errors clearly
|--------------------------------------------------------------------------
*/

function logAxiosError(label, error) {
  console.error("========================================");
  console.error(label);
  console.error("Message:", error.message);

  if (error.config) {
    console.error("Request method:", error.config.method);
    console.error("Request URL:", error.config.url);
  }

  if (error.response) {
    console.error("Response status:", error.response.status);
    console.error(
      "Response status text:",
      error.response.statusText
    );

    console.error(
      "Response headers:",
      JSON.stringify(
        error.response.headers || {},
        null,
        2
      )
    );

    console.error("Response body:");

    if (
      typeof error.response.data ===
      "string"
    ) {
      console.error(error.response.data);
    } else {
      console.error(
        JSON.stringify(
          error.response.data || {},
          null,
          2
        )
      );
    }
  } else if (error.request) {
    console.error(
      "Request was sent but no response was received."
    );
  } else {
    console.error(
      "Request could not be created."
    );
  }

  console.error("Stack:");
  console.error(error.stack);
  console.error("========================================");
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
    "Requesting Shopify Admin API access token"
  );

  console.log(
    "Shopify token URL:",
    tokenUrl
  );

  let response;

  try {
    response = await axios.post(
      tokenUrl,
      requestBody.toString(),
      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
  } catch (error) {
    logAxiosError(
      "SHOPIFY TOKEN REQUEST FAILED",
      error
    );

    throw error;
  }

  console.log(
    "Shopify token response status:",
    response.status
  );

  console.log(
    "Shopify token response body:",
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(
          response.data || {},
          null,
          2
        )
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    const tokenError =
      new Error(
        `Shopify token request failed with status ${response.status}.`
      );

    tokenError.response = response;

    throw tokenError;
  }

  const accessToken =
    response.data?.access_token;

  const expiresInSeconds =
    Number(
      response.data?.expires_in ||
        86399
    );

  if (!accessToken) {
    throw new Error(
      "Shopify did not return an access token."
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
    "Shopify Admin API access token acquired"
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

  console.log(
    "Searching Shopify order:",
    searchQuery
  );

  let response;

  try {
    response = await axios.post(
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
        validateStatus: () => true,
      }
    );
  } catch (error) {
    logAxiosError(
      "SHOPIFY GRAPHQL REQUEST FAILED",
      error
    );

    throw error;
  }

  console.log(
    "Shopify GraphQL response status:",
    response.status
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    console.error(
      "Shopify GraphQL response body:",
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(
            response.data || {},
            null,
            2
          )
    );

    const graphqlHttpError =
      new Error(
        `Shopify GraphQL request failed with status ${response.status}.`
      );

    graphqlHttpError.response =
      response;

    throw graphqlHttpError;
  }

  if (
    Array.isArray(
      response.data?.errors
    ) &&
    response.data.errors.length > 0
  ) {
    console.error(
      "Shopify GraphQL top-level errors:",
      JSON.stringify(
        response.data.errors,
        null,
        2
      )
    );

    throw new Error(
      response.data.errors
        .map(
          (graphqlError) =>
            graphqlError.message
        )
        .join("; ")
    );
  }

  const userErrors =
    response.data?.data?.orders
      ?.userErrors;

  if (
    Array.isArray(userErrors) &&
    userErrors.length > 0
  ) {
    console.error(
      "Shopify GraphQL user errors:",
      JSON.stringify(
        userErrors,
        null,
        2
      )
    );
  }

  const orders =
    response.data?.data?.orders
      ?.nodes;

  if (!Array.isArray(orders)) {
    console.error(
      "Shopify GraphQL returned no orders array:",
      JSON.stringify(
        response.data || {},
        null,
        2
      )
    );

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
      return res
        .status(403)
        .json({
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
              file.type ===
                "product" ||
              file.type ===
                "journal" ||
              file.type ===
                "interior"
          ) || null;

        const cover =
          manifest.files.find(
            (file) =>
              file.type ===
              "cover"
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
      } catch (
        manifestError
      ) {
        console.error(
          `Manifest lookup failed for item ${itemId}`
        );

        console.error(
          "Manifest error message:",
          manifestError.message
        );

        console.error(
          "Manifest error stack:",
          manifestError.stack
        );
      }
    }

    if (
      downloads.length === 0
    ) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Your journal files were not found or are still being generated.",
        });
    }

    return res
      .status(200)
      .json({
        success: true,
        orderNumber:
          order.name,
        downloads,
      });
  } catch (error) {
    logAxiosError(
      "DOWNLOADS ROUTE FAILED",
      error
    );

    const shopifyStatus =
      error.response?.status;

    if (
      shopifyStatus === 400 ||
      shopifyStatus === 401
    ) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            "Shopify authentication failed. Check the Render logs for the exact Shopify response.",
        });
    }

    if (
      shopifyStatus === 403
    ) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            "Shopify denied order access. Check the Render logs for the exact Shopify response.",
        });
    }

    if (
      shopifyStatus === 404
    ) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            "Shopify returned a 404 error. Check SHOPIFY_STORE and the Render logs.",
        });
    }

    if (
      String(error.message).includes(
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
          "Unable to retrieve downloads. Check the Render logs for the exact error.",
      });
  }
});

module.exports = router;