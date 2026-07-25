require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const {
  generateJournalPDFs,
} = require("./services/pdfGenerator");

const app = express();
const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| Shopify order webhook
|--------------------------------------------------------------------------
| This route must use express.raw() because Shopify HMAC verification
| requires the original, unmodified request body.
|--------------------------------------------------------------------------
*/

app.post(
  "/shopify/order",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const shopifyHmac = req.get("X-Shopify-Hmac-Sha256");
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

      if (!shopifyHmac || !secret) {
        console.error("Missing Shopify HMAC or webhook secret");

        return res.status(401).send("Unauthorized");
      }

      const calculatedHmac = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("base64");

      const receivedBuffer = Buffer.from(
        shopifyHmac,
        "base64"
      );

      const calculatedBuffer = Buffer.from(
        calculatedHmac,
        "base64"
      );

      const isValid =
        receivedBuffer.length === calculatedBuffer.length &&
        crypto.timingSafeEqual(
          receivedBuffer,
          calculatedBuffer
        );

      if (!isValid) {
        console.error("Invalid Shopify webhook signature");

        return res.status(401).send("Unauthorized");
      }

      const order = JSON.parse(
        req.body.toString("utf8")
      );

      console.log("Verified Shopify order received");
      console.log("Order ID:", order.id);
      console.log("Order number:", order.order_number);

      console.log("===== CUSTOMER =====");

      console.log({
        email: order.email,
        firstName: order.customer?.first_name,
        lastName: order.customer?.last_name,
      });

      console.log("===== PRODUCTS =====");

      order.line_items?.forEach((item, index) => {
        console.log(`Product ${index + 1}:`, {
          title: item.title,
          variantTitle: item.variant_title,
          productId: item.product_id,
          variantId: item.variant_id,
          quantity: item.quantity,
          sku: item.sku,
          properties: item.properties,
        });
      });

      /*
      |--------------------------------------------------------------------------
      | Generate the cover and interior PDFs
      |--------------------------------------------------------------------------
      */

      const generatedFiles =
        await generateJournalPDFs(order);

      console.log("===== PDF GENERATION COMPLETE =====");
      console.log("Interior PDF:", generatedFiles.interiorPath);
      console.log("Cover PDF:", generatedFiles.coverPath);

      return res.status(200).json({
        success: true,
        message:
          "Verified Shopify order received and PDFs generated",
        orderId: order.id,
        orderNumber: order.order_number,
        files: {
          interior: generatedFiles.interiorPath,
          cover: generatedFiles.coverPath,
        },
      });
    } catch (error) {
      console.error("Shopify webhook processing failed");

      console.error({
        message: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: "Order processing failed",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Regular JSON parsing
|--------------------------------------------------------------------------
| Keep this below the Shopify webhook route so it does not alter the
| raw webhook request body.
|--------------------------------------------------------------------------
*/

app.use(express.json());

/*
|--------------------------------------------------------------------------
| Home route
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("Fresh Start Paper API Running");
});

/*
|--------------------------------------------------------------------------
| Health-check route
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| Error handler
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});