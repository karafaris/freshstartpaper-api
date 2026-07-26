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

const {
  submitCloudprinterOrder,
} = require("../services/cloudprinterService");

const router = express.Router();

const JOURNAL_TOTAL_PAGES = 366;

/**
 * Verify the Shopify webhook signature.
 *
 * Shopify signs the exact raw request body using the webhook
 * secret. The body must remain a Buffer until verification
 * is complete.
 */
function verifyShopifyWebhook({
  rawBody,
  receivedHmac,
  webhookSecret,
}) {
  if (!Buffer.isBuffer(rawBody)) {
    return false;
  }

  if (!receivedHmac || !webhookSecret) {
    return false;
  }

  const calculatedHmac = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("base64");

  let receivedBuffer;
  let calculatedBuffer;

  try {
    receivedBuffer = Buffer.from(
      receivedHmac,
      "base64"
    );

    calculatedBuffer = Buffer.from(
      calculatedHmac,
      "base64"
    );
  } catch (error) {
    console.error(
      "Unable to convert Shopify HMAC values to buffers",
      error
    );

    return false;
  }

  if (
    receivedBuffer.length !==
    calculatedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    calculatedBuffer
  );
}

/**
 * Return true when the line item has enough information
 * to generate personalized journal files.
 */
function isValidLineItem(lineItem) {
  return Boolean(
    lineItem &&
      lineItem.id &&
      Number(lineItem.quantity || 0) > 0
  );
}

/**
 * Process one Shopify line item.
 *
 * Each line item gets:
 *
 * 1. Its own interior PDF
 * 2. Its own cover PDF
 * 3. Its own Cloudinary uploads
 * 4. Its own stored file manifest
 * 5. Its own Cloudprinter print-order submission
 */
async function processLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  lineItemIndex,
  totalLineItems,
}) {
  const itemId = lineItem.id;

  let generatedFiles = null;

  console.log(
    `Starting line item ${
      lineItemIndex + 1
    } of ${totalLineItems}`
  );

  console.log({
    orderId,
    orderNumber,
    itemId,
    title: lineItem.title,
    variantTitle:
      lineItem.variant_title,
    sku: lineItem.sku,
    quantity: lineItem.quantity,
  });

  try {
    /*
    |--------------------------------------------------------------------------
    | Generate PDFs
    |--------------------------------------------------------------------------
    */

    console.log(
      `Starting PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateJournalPDFs(
        order,
        lineItem
      );

    if (
      !generatedFiles?.interiorPath ||
      !generatedFiles?.coverPath
    ) {
      throw new Error(
        `PDF generation did not return both files for item ${itemId}`
      );
    }

    console.log(
      "===== PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      totalPages:
        JOURNAL_TOTAL_PAGES,
      interiorPath:
        generatedFiles.interiorPath,
      coverPath:
        generatedFiles.coverPath,
    });

    /*
    |--------------------------------------------------------------------------
    | Upload PDFs to Cloudinary
    |--------------------------------------------------------------------------
    */

    console.log(
      `Starting Cloudinary upload for order ${orderNumber}, item ${itemId}`
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

    if (
      !uploadedFiles?.interior?.url ||
      !uploadedFiles?.cover?.url
    ) {
      throw new Error(
        `Cloudinary did not return complete file information for item ${itemId}`
      );
    }

    if (
      !uploadedFiles?.interior
        ?.md5sum ||
      !uploadedFiles?.cover?.md5sum
    ) {
      throw new Error(
        `Cloudinary file information does not include both MD5 checksums for item ${itemId}`
      );
    }

    console.log(
      "===== CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      interiorUrl:
        uploadedFiles.interior.url,
      interiorMd5:
        uploadedFiles.interior.md5sum,
      coverUrl:
        uploadedFiles.cover.url,
      coverMd5:
        uploadedFiles.cover.md5sum,
    });

    /*
    |--------------------------------------------------------------------------
    | Save the file manifest
    |--------------------------------------------------------------------------
    */

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

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        `The file manifest was not saved correctly for item ${itemId}`
      );
    }

    console.log(
      "===== FILE MANIFEST SAVED ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      manifestUrl:
        storedFiles.manifestUrl,
    });

    /*
    |--------------------------------------------------------------------------
    | Submit the print order to Cloudprinter
    |--------------------------------------------------------------------------
    */

    console.log(
      `Starting Cloudprinter submission for order ${orderNumber}, item ${itemId}`
    );

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,
        totalPages:
          JOURNAL_TOTAL_PAGES,
      });

    if (
      !cloudprinterResult?.success
    ) {
      throw new Error(
        `Cloudprinter did not confirm the order for item ${itemId}`
      );
    }

    console.log(
      "===== CLOUDPRINTER SUBMISSION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      cloudprinterOrderReference:
        cloudprinterResult
          .orderReference,
      cloudprinterItemReference:
        cloudprinterResult
          .itemReference,
      cloudprinterHttpStatus:
        cloudprinterResult.status,
    });

    console.log(
      `✅ Item ${itemId} processing complete`
    );

    return {
      success: true,
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      totalPages:
        JOURNAL_TOTAL_PAGES,
      manifestUrl:
        storedFiles.manifestUrl,
      cloudprinterOrderReference:
        cloudprinterResult
          .orderReference,
      cloudprinterItemReference:
        cloudprinterResult
          .itemReference,
      cloudprinterStatus:
        cloudprinterResult.status,
    };
  } catch (error) {
    console.error(
      `Processing failed for line item ${itemId}`
    );

    console.error({
      orderId,
      orderNumber,
      itemId,
      title: lineItem.title,
      message: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      error: error.message,
    };
  } finally {
    /*
    |--------------------------------------------------------------------------
    | Delete temporary Render files
    |--------------------------------------------------------------------------
    */

    if (
      generatedFiles?.interiorPath ||
      generatedFiles?.coverPath
    ) {
      try {
        await deleteGeneratedLocalFiles({
          interiorPath:
            generatedFiles.interiorPath,
          coverPath:
            generatedFiles.coverPath,
        });

        console.log(
          `Temporary files deleted for item ${itemId}`
        );
      } catch (cleanupError) {
        console.error(
          `Unable to delete temporary files for item ${itemId}`
        );

        console.error({
          orderId,
          orderNumber,
          itemId,
          message:
            cleanupError.message,
          stack:
            cleanupError.stack,
        });
      }
    }
  }
}

/**
 * Process every valid line item in the order.
 *
 * Items are handled one at a time so Render does not attempt
 * to generate several 366-page PDF sets simultaneously.
 */
async function processOrderInBackground(
  order
) {
  const orderId = order.id;

  const orderNumber =
    order.order_number ||
    order.id ||
    Date.now();

  const allLineItems =
    Array.isArray(
      order.line_items
    )
      ? order.line_items
      : [];

  const validLineItems =
    allLineItems.filter(
      isValidLineItem
    );

  if (
    validLineItems.length === 0
  ) {
    throw new Error(
      "The Shopify order does not contain any valid line items"
    );
  }

  console.log(
    "===== BACKGROUND ORDER PROCESSING STARTED ====="
  );

  console.log({
    orderId,
    orderNumber,
    totalLineItems:
      allLineItems.length,
    validLineItems:
      validLineItems.length,
    financialStatus:
      order.financial_status,
  });

  const results = [];

  for (
    let index = 0;
    index <
    validLineItems.length;
    index += 1
  ) {
    const lineItem =
      validLineItems[index];

    const result =
      await processLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        lineItemIndex: index,
        totalLineItems:
          validLineItems.length,
      });

    results.push(result);
  }

  const successfulItems =
    results.filter(
      (result) =>
        result.success
    );

  const failedItems =
    results.filter(
      (result) =>
        !result.success
    );

  console.log(
    "===== ORDER PROCESSING SUMMARY ====="
  );

  console.log({
    orderId,
    orderNumber,
    totalItems: results.length,
    successfulItems:
      successfulItems.length,
    failedItems:
      failedItems.length,
    results,
  });

  if (
    failedItems.length > 0
  ) {
    console.error(
      `Order ${orderNumber} completed with ${failedItems.length} failed line item(s)`
    );
  }

  if (
    successfulItems.length ===
    results.length
  ) {
    console.log(
      `✅ Order ${orderNumber} processing and Cloudprinter submission complete`
    );
  } else if (
    successfulItems.length > 0
  ) {
    console.log(
      `⚠️ Order ${orderNumber} partially completed`
    );
  } else {
    console.error(
      `❌ Order ${orderNumber} failed completely`
    );
  }
}

router.post(
  "/order",
  express.raw({
    type: "application/json",
  }),
  async (req, res) => {
    try {
      const shopifyHmac =
        req.get(
          "X-Shopify-Hmac-Sha256"
        );

      const webhookSecret =
        process.env
          .SHOPIFY_WEBHOOK_SECRET;

      if (!shopifyHmac) {
        console.error(
          "Missing Shopify webhook HMAC header"
        );

        return res
          .status(401)
          .json({
            success: false,
            message:
              "Unauthorized",
          });
      }

      if (!webhookSecret) {
        console.error(
          "SHOPIFY_WEBHOOK_SECRET is not configured"
        );

        return res
          .status(500)
          .json({
            success: false,
            message:
              "Webhook configuration error",
          });
      }

      if (
        !Buffer.isBuffer(
          req.body
        )
      ) {
        console.error(
          "Shopify webhook body is not a raw Buffer"
        );

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid webhook body",
          });
      }

      const isValid =
        verifyShopifyWebhook({
          rawBody: req.body,
          receivedHmac:
            shopifyHmac,
          webhookSecret,
        });

      if (!isValid) {
        console.error(
          "Invalid Shopify webhook signature"
        );

        return res
          .status(401)
          .json({
            success: false,
            message:
              "Unauthorized",
          });
      }

      let order;

      try {
        order = JSON.parse(
          req.body.toString(
            "utf8"
          )
        );
      } catch (error) {
        console.error(
          "Unable to parse Shopify webhook JSON"
        );

        console.error({
          message:
            error.message,
          stack: error.stack,
        });

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid JSON",
          });
      }

      if (!order?.id) {
        console.error(
          "Shopify webhook does not contain an order ID"
        );

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid Shopify order",
          });
      }

      const orderId =
        order.id;

      const orderNumber =
        order.order_number ||
        order.id ||
        Date.now();

      const lineItems =
        Array.isArray(
          order.line_items
        )
          ? order.line_items
          : [];

      console.log(
        "✅ Verified Shopify order received"
      );

      console.log(
        "===== ORDER ====="
      );

      console.log({
        id: orderId,
        orderNumber,
        orderName:
          order.name,
        email:
          order.email,
        financialStatus:
          order.financial_status,
        fulfillmentStatus:
          order.fulfillment_status,
        createdAt:
          order.created_at,
        lineItemCount:
          lineItems.length,
      });

      console.log(
        "===== PRODUCTS ====="
      );

      lineItems.forEach(
        (item, index) => {
          console.log(
            `Product ${
              index + 1
            }:`,
            {
              lineItemId:
                item.id,
              productId:
                item.product_id,
              variantId:
                item.variant_id,
              title:
                item.title,
              variantTitle:
                item.variant_title,
              quantity:
                item.quantity,
              sku: item.sku,
              properties:
                item.properties,
            }
          );
        }
      );

      /*
       * Shopify needs a fast response.
       *
       * Respond before generating PDFs because generating
       * hundreds of pages may exceed Shopify's webhook timeout.
       */
      res.status(200).json({
        success: true,
        message:
          "Verified Shopify order accepted",
        orderId,
        orderNumber,
        lineItemCount:
          lineItems.length,
      });

      /*
       * Continue processing after Shopify receives its response.
       */
      setImmediate(() => {
        processOrderInBackground(
          order
        ).catch(
          (error) => {
            console.error(
              "Background order processing failed"
            );

            console.error({
              orderId,
              orderNumber,
              message:
                error.message,
              stack:
                error.stack,
            });
          }
        );
      });

      return;
    } catch (error) {
      console.error(
        "Shopify webhook processing failed"
      );

      console.error({
        message:
          error.message,
        stack: error.stack,
      });

      if (
        !res.headersSent
      ) {
        return res
          .status(500)
          .json({
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