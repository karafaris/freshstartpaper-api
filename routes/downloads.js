const express = require("express");
const axios = require("axios");

const {
  getOrderFiles,
} = require("../services/orderFileStore");

const router = express.Router();

const SHOPIFY_API_VERSION = "2026-07";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function normalizeShopifyStore(store) {
  return String(store || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

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
      response.data?.expires_in || 86399
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

  return cachedAccessToken;
}

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

  const response = await axios.post(
    graphqlUrl,
    {
      query,
      variables: {
        searchQuery:
          `name:#${orderNumber}`,
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
    throw new Error(
      response.data.errors
        .map(
          (graphqlError) =>
            graphqlError.message
        )
        .join("; ")
    );
  }

  const orders =
    response.data?.data?.orders?.nodes;

  if (!Array.isArray(orders)) {
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

      return orderName === requestedNumber;
    }) || null
  );
}

router.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message:
      "Downloads route is working.",
    timestamp:
      new Date().toISOString(),
  });
});

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

    const lineItems =
      order.lineItems?.nodes;

    if (!orderId) {
      throw new Error(
        "Shopify did not return the internal order ID."
      );
    }

    if (!Array.isArray(lineItems)) {
      throw new Error(
        "Shopify did not return the order line items."
      );
    }

    const downloads = [];

    for (const item of lineItems) {
      const itemId =
        item.legacyResourceId;

      if (!itemId) {
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
        message: error.message,
        shopifyMessage,
      }
    );

    if (status === 400) {
      return res.status(500).json({
        success: false,
        message:
          shopifyMessage ||
          "Shopify rejected the authentication request with status 400.",
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
        message: error.message,
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