const express = require("express");
const crypto = require("crypto");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const {
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
} = require("../services/cloudinaryService");

const {
  saveOrderFiles,
} = require("../services/orderFileStore");

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

      const orderId = order.id;
      const orderNumber =
        order.order_number ||
        order.id ||
        Date.now();

      console.log(
        "✅ Verified Shopify order received"
      );

      console.log("===== ORDER =====");

      console.log({
        id: orderId,
        orderNumber,
        orderName: order.name,
        email: order.email,
        financialStatus:
          order.financial_status,
        fulfillmentStatus:
          order.fulfillment_status,
        createdAt: order.created_at,
      });

      console.log("===== PRODUCTS =====");

      order.line_items?.forEach(
        (item, index) => {
          console.log(
            `Product ${index + 1}:`,
            {
              lineItemId: item.id,
              title: item.title,
              variantTitle:
                item.variant_title,
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
        orderId,
        orderNumber,
      });

      setImmediate(async () => {
        let generatedFiles;

        try {
          const lineItem =
            order.line_items?.[0];

          if (!lineItem?.id) {
            throw new Error(
              "The order does not contain a valid line-item ID"
            );
          }

          const itemId = lineItem.id;

          console.log(
            `Starting PDF generation for order ${orderNumber}`
          );

          generatedFiles =
            await generateJournalPDFs(order);

          console.log(
            "===== PDF GENERATION COMPLETE ====="
          );

          console.log({
            orderId,
            orderNumber,
            itemId,
            interiorPath:
              generatedFiles.interiorPath,
            coverPath:
              generatedFiles.coverPath,
          });

          console.log(
            `Starting Cloudinary upload for order ${orderNumber}`
          );

          const uploadedFiles =
            await uploadGeneratedPDFs({
              interiorPath:
                generatedFiles.interiorPath,
              coverPath:
                generatedFiles.coverPath,
              orderId,
              itemId,
            });

          console.log(
            "===== CLOUDINARY UPLOAD COMPLETE ====="
          );

          console.log({
            productUrl:
              uploadedFiles.interior.url,
            productMd5:
              uploadedFiles.interior.md5sum,
            coverUrl:
              uploadedFiles.cover.url,
            coverMd5:
              uploadedFiles.cover.md5sum,
          });

          const storedFiles =
            await saveOrderFiles({
              orderId,
              orderNumber,
              itemId,
              files: [
                uploadedFiles.interior,
                uploadedFiles.cover,
              ],
            });

          console.log(
            "===== FILE MANIFEST SAVED ====="
          );

          console.log({
            orderId,
            itemId,
            manifestUrl:
              storedFiles.manifestUrl,
          });

          await deleteGeneratedLocalFiles({
            interiorPath:
              generatedFiles.interiorPath,
            coverPath:
              generatedFiles.coverPath,
          });

          console.log(
            `✅ Order ${orderNumber} processing complete`
          );
        } catch (error) {
          console.error(
            "Background order processing failed"
          );

          console.error({
            orderId,
            orderNumber,
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

      return;
    }
  }
);

module.exports = router;