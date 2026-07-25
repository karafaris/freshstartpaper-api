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
| Used only to verify the route is deployed correctly.
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
| Finds a customer's downloadable journal files.
|--------------------------------------------------------------------------
*/

router.post("/", async (req, res) => {
  try {
    const { orderNumber, email } = req.body;

    if (!orderNumber || !email) {
      return res.status(400).json({
        success: false,
        message: "Order number and email are required.",
      });
    }

    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/orders.json`,
      {
        headers: {
          "X-Shopify-Access-Token":
            process.env.SHOPIFY_ACCESS_TOKEN,
        },
        params: {
          name: `#${orderNumber}`,
          status: "any",
        },
      }
    );

    const order = response.data.orders?.[0];

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (
      !order.email ||
      order.email.toLowerCase() !==
        email.toLowerCase()
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Order number and email do not match.",
      });
    }

    const downloads = [];

    for (const item of order.line_items) {
      const manifest =
        await getOrderFiles({
          orderId: order.id,
          itemId: item.id,
        });

      if (!manifest) {
        continue;
      }

      const journal =
        manifest.files.find(
          (file) => file.type === "product"
        );

      const cover =
        manifest.files.find(
          (file) => file.type === "cover"
        );

      downloads.push({
        product: item.title,
        journal,
        cover,
      });
    }

    if (!downloads.length) {
      return res.status(404).json({
        success: false,
        message:
          "Your journal is still being generated.",
      });
    }

    return res.status(200).json({
      success: true,
      downloads,
    });
  } catch (error) {
    console.error("Downloads route failed:");
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve downloads.",
    });
  }
});

module.exports = router;