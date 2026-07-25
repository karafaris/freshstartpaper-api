const express = require("express");
const axios = require("axios");

const {
  getOrderFiles,
} = require("../services/orderFileStore");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET /downloads
|--------------------------------------------------------------------------
| Confirms that the downloads route is deployed and working.
|--------------------------------------------------------------------------
*/

router.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Downloads route is working.",
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| POST /downloads
|--------------------------------------------------------------------------
| Verifies the Shopify order and returns the generated journal files.
|--------------------------------------------------------------------------
*/

router.post("/", async (req, res) => {
  try {
    const shopifyStore = process.env.SHOPIFY_STORE;
    const shopifyAccessToken =
      process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyStore) {
      console.error(
        "Missing Render environment variable: SHOPIFY_STORE"
      );

      return res.status(500).json({
        success: false,
        message:
          "Server configuration error: SHOPIFY_STORE is missing.",
      });
    }

    if (!shopifyAccessToken) {
      console.error(
        "Missing Render environment variable: SHOPIFY_ACCESS_TOKEN"
      );

      return res.status(500).json({
        success: false,
        message:
          "Server configuration error: SHOPIFY_ACCESS_TOKEN is missing.",
      });
    }

    const orderNumber = String(
      req.body.orderNumber || ""
    )
      .replace("#", "")
      .trim();

    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    if (!orderNumber || !email) {
      return res.status(400).json({
        success: false,
        message:
          "Order number and email are required.",
      });
    }

    const shopifyUrl =
      `https://${shopifyStore}` +
      `/admin/api/2025-01/orders.json`;

    console.log(
      `Looking up Shopify order #${orderNumber}`
    );

    const response = await axios.get(
      shopifyUrl,
      {
        headers: {
          "X-Shopify-Access-Token":
            shopifyAccessToken,
          "Content-Type": "application/json",
        },
        params: {
          name: `#${orderNumber}`,
          status: "any",
          limit: 10,
        },
        timeout: 15000,
      }
    );

    const orders =
      response.data &&
      Array.isArray(response.data.orders)
        ? response.data.orders
        : [];

    const order = orders.find(
      (shopifyOrder) =>
        String(shopifyOrder.name || "")
          .replace("#", "")
          .trim() === orderNumber
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
      order.contact_email ||
      order.customer?.email ||
      ""
    )
      .trim()
      .toLowerCase();

    if (!orderEmail || orderEmail !== email) {
      return res.status(403).json({
        success: false,
        message:
          "The order number and email address do not match.",
      });
    }

    const downloads = [];

    for (const item of order.line_items || []) {
      try {
        const manifest =
          await getOrderFiles({
            orderId: order.id,
            itemId: item.id,
          });

        if (
          !manifest ||
          !Array.isArray(manifest.files)
        ) {
          console.log(
            `No manifest found for order ${order.id}, item ${item.id}`
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
            (file) => file.type === "cover"
          ) || null;

        if (!journal && !cover) {
          continue;
        }

        downloads.push({
          product:
            item.title || "Custom Journal",
          itemId: item.id,
          journal,
          cover,
        });
      } catch (manifestError) {
        console.error(
          `Manifest lookup failed for item ${item.id}:`,
          manifestError
        );
      }
    }

    if (!downloads.length) {
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
    console.error(
      "Downloads route failed:",
      error.response?.data ||
      error.message ||
      error
    );

    if (error.response?.status === 401) {
      return res.status(500).json({
        success: false,
        message:
          "Shopify authentication failed. Check SHOPIFY_ACCESS_TOKEN in Render.",
      });
    }

    if (error.response?.status === 403) {
      return res.status(500).json({
        success: false,
        message:
          "Shopify denied access. Confirm that the app has permission to read orders.",
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