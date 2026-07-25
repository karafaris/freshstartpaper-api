const express = require("express");
const crypto = require("crypto");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const router = express.Router();

router.post(
  "/order",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const shopifyHmac = req.get(
        "X-Shopify-Hmac-Sha256"
      );

      const webhookSecret =
        process.env.SHOPIFY_WEBHOOK_SECRET;

      if (!shopifyHmac || !webhookSecret) {
        console.error(
          "Missing Shopify HMAC or webhook secret"
        );

        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      if (!Buffer.isBuffer(req.body)) {
        console.error(
          "Shopify webhook body is not a raw Buffer"
        );

        return res.status(400).json({
          success: false,
          message: "Invalid webhook body",
        });
      }

      const calculatedHmac = crypto
        .createHmac("sha256", webhookSecret)
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
        receivedBuffer.length ===
          calculatedBuffer.length &&
        crypto.timingSafeEqual(
          receivedBuffer,
          calculatedBuffer
        );

      if (!isValid) {
        console.error(
          "Invalid Shopify webhook signature"
        );

        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      let order;

      try {
        order = JSON.parse(
          req.body.toString("utf8")
        );
      } catch (error) {
        console.error(
          "Unable to parse Shopify webhook JSON",
          error
        );

        return res.status(400).json({
          success: false,
          message: "Invalid JSON",
        });
      }

      console.log(
        "✅ Verified Shopify order received"
      );

      console.log("===== ORDER =====");

      console.log({
        id: order.id,
        orderNumber: order.order_number,
        orderName: order.name,
        email: order.email,
        financialStatus:
          order.financial_status,
        createdAt: order.created_at,
      });

      console.log("===== CUSTOMER =====");

      console.log({
        email: order.email,
        firstName:
          order.customer?.first_name,
        lastName:
          order.customer?.last_name,
      });

      console.log("===== PRODUCTS =====");

      order.line_items?.forEach(
        (item, index) => {
          console.log(
            `Product ${index + 1}:`,
            {
              title: item.title,
              variantTitle:
                item.variant_title,
              productId:
                item.product_id,
              variantId:
                item.variant_id,
              quantity: item.quantity,
              sku: item.sku,
              properties:
                item.properties,
            }
          );
        }
      );

      res.status(200).json({
        success: true,
        message:
          "Verified Shopify order accepted",
        orderId: order.id,
        orderNumber:
          order.order_number,
      });

      setImmediate(async () => {
        try {
          console.log(
            `Starting PDF generation for order ${
              order.order_number ||
              order.id
            }`
          );

          const generatedFiles =
            await generateJournalPDFs(
              order
            );

          console.log(
            "===== PDF GENERATION COMPLETE ====="
          );

          console.log({
            interiorPath:
              generatedFiles.interiorPath,
            coverPath:
              generatedFiles.coverPath,
          });
        } catch (error) {
          console.error(
            "Background PDF generation failed"
          );

          console.error({
            orderId: order.id,
            orderNumber:
              order.order_number,
            message: error.message,
            stack: error.stack,
          });
        }
      });

      return;
    } catch (error) {
      console.error(
        "Shopify webhook processing failed"
      );

      console.error({
        message: error.message,
        stack: error.stack,
      });

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message:
            "Order processing failed",
        });
      }
    }
  }
);

module.exports = router;