const express = require("express");
const crypto = require("crypto");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const {
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
} = require("../services/cloudinaryService");

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

      /*
      |--------------------------------------------------------------------------
      | Verify Shopify HMAC signature
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | Parse verified Shopify order
      |--------------------------------------------------------------------------
      */

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

      const orderNumber =
        order.order_number ||
        order.id ||
        Date.now();

      console.log(
        "✅ Verified Shopify order received"
      );

      console.log("===== ORDER =====");

      console.log({
        id: order.id,
        orderNumber,
        orderName: order.name,
        email: order.email,
        financialStatus:
          order.financial_status,
        fulfillmentStatus:
          order.fulfillment_status,
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
              lineItemId: item.id,
              quantity: item.quantity,
              sku: item.sku,
              properties:
                item.properties,
            }
          );
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Respond to Shopify immediately
      |--------------------------------------------------------------------------
      | PDF generation and upload happen after Shopify receives 200 OK.
      |--------------------------------------------------------------------------
      */

      res.status(200).json({
        success: true,
        message:
          "Verified Shopify order accepted",
        orderId: order.id,
        orderNumber,
      });

      /*
      |--------------------------------------------------------------------------
      | Generate and upload PDFs in the background
      |--------------------------------------------------------------------------
      */

      setImmediate(async () => {
        let generatedFiles;

        try {
          console.log(
            `Starting PDF generation for order ${orderNumber}`
          );

          generatedFiles =
            await generateJournalPDFs(order);

          console.log(
            "===== PDF GENERATION COMPLETE ====="
          );

          console.log({
            orderId: order.id,
            orderNumber,
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
              orderNumber,
            });

          console.log(
            "===== CLOUDINARY UPLOAD COMPLETE ====="
          );

          console.log({
            orderId: order.id,
            orderNumber,
            interiorUrl:
              uploadedFiles.interior.secureUrl,
            interiorPublicId:
              uploadedFiles.interior.publicId,
            coverUrl:
              uploadedFiles.cover.secureUrl,
            coverPublicId:
              uploadedFiles.cover.publicId,
          });

          /*
          |--------------------------------------------------------------------------
          | Remove temporary Render files after successful upload
          |--------------------------------------------------------------------------
          */

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
            orderId: order.id,
            orderNumber,
            message: error.message,
            stack: error.stack,
          });

          /*
          | Local PDFs are intentionally kept if Cloudinary upload fails.
          | This makes troubleshooting easier.
          */
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