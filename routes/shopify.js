const express = require("express");
const crypto = require("crypto");
const fs = require("fs");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const {
  generateCalendarPDFs,
} = require("../services/calendarPdfGenerator");

const {
  generateNotebookPDFs,
} = require("../services/notebookPdfGenerator");

const {
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
} = require("../services/cloudinaryService");

const {
  uploadCalendarPdf,
} = require("../services/calendarCloudinaryService");

const {
  saveOrderFiles,
} = require("../services/orderFileStore");

const {
  submitCloudprinterOrder,
} = require("../services/cloudprinterService");

const {
  resolveProduct,
} = require("../services/productResolver");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Verify Shopify webhook
|--------------------------------------------------------------------------
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

/*
|--------------------------------------------------------------------------
| Validate line item
|--------------------------------------------------------------------------
*/

function isValidLineItem(lineItem) {
  return Boolean(
    lineItem &&
      lineItem.id &&
      Number(lineItem.quantity || 0) > 0
  );
}

/*
|--------------------------------------------------------------------------
| Delete temporary calendar PDF
|--------------------------------------------------------------------------
*/

async function deleteCalendarLocalFile(productPath) {
  if (!productPath) {
    return;
  }

  try {
    await fs.promises.unlink(productPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

/*
|--------------------------------------------------------------------------
| Process journal
|--------------------------------------------------------------------------
*/

async function processJournalLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId = lineItem.id;
  let generatedFiles = null;

  try {
    console.log(
      `Starting JOURNAL PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles = await generateJournalPDFs(
      order,
      lineItem
    );

    if (
      !generatedFiles?.interiorPath ||
      !generatedFiles?.coverPath
    ) {
      throw new Error(
        `Journal PDF generation did not return both files for item ${itemId}`
      );
    }

    console.log(
      "===== JOURNAL PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productKind: "journal",
      totalPages:
        productConfiguration.totalPages,
      interiorPath:
        generatedFiles.interiorPath,
      coverPath:
        generatedFiles.coverPath,
    });

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
      !uploadedFiles?.cover?.url ||
      !uploadedFiles?.interior?.md5sum ||
      !uploadedFiles?.cover?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return complete journal files for item ${itemId}`
      );
    }

    console.log(
      "===== JOURNAL CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      interiorUrl:
        uploadedFiles.interior.url,
      coverUrl:
        uploadedFiles.cover.url,
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

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        `The journal file manifest was not saved correctly for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration.totalPages,

        productConfiguration,
      });

    if (!cloudprinterResult?.success) {
      throw new Error(
        `Cloudprinter did not confirm the journal order for item ${itemId}`
      );
    }

    return {
      success: true,
      productKind: "journal",
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,

      totalPages:
        productConfiguration.totalPages,

      manifestUrl:
        storedFiles.manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult.orderReference,

      cloudprinterItemReference:
        cloudprinterResult.itemReference,

      cloudprinterStatus:
        cloudprinterResult.status,
    };
  } finally {
    if (
      generatedFiles?.interiorPath ||
      generatedFiles?.coverPath
    ) {
      await deleteGeneratedLocalFiles({
        interiorPath:
          generatedFiles.interiorPath,

        coverPath:
          generatedFiles.coverPath,
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| Process notebook
|--------------------------------------------------------------------------
|
| Generates:
|
| - 365-page A3 landscape interior PDF
| - Two-page front/back cover PDF
|
| Uploads:
|
| - interior
| - cover
|
| Cloudprinter maps those uploaded files to:
|
| - book
| - cover
|
*/

async function processNotebookLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId = lineItem.id;
  let generatedFiles = null;

  try {
    console.log(
      `Starting NOTEBOOK PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateNotebookPDFs(
        order,
        lineItem
      );

    if (
      !generatedFiles?.interiorPath ||
      !generatedFiles?.coverPath
    ) {
      throw new Error(
        `Notebook PDF generation did not return both files for item ${itemId}`
      );
    }

    /*
     * Stop production if the notebook generator returns
     * anything other than the locked 365-page interior.
     */

    if (
      Number(generatedFiles.totalPages) !==
      Number(
        productConfiguration.totalPages
      )
    ) {
      throw new Error(
        `Notebook item ${itemId} generated ${generatedFiles.totalPages} interior pages; expected ${productConfiguration.totalPages}`
      );
    }

    /*
     * The Cloudprinter notebook package requires a two-page
     * cover PDF: front cover followed by back cover.
     */

    if (
      Number(generatedFiles.coverPages) !==
      2
    ) {
      throw new Error(
        `Notebook item ${itemId} generated ${generatedFiles.coverPages} cover pages; expected 2`
      );
    }

    console.log(
      "===== NOTEBOOK PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productKind: "notebook",
      sku: lineItem.sku,
      totalPages:
        generatedFiles.totalPages,
      coverPages:
        generatedFiles.coverPages,
      interiorPath:
        generatedFiles.interiorPath,
      coverPath:
        generatedFiles.coverPath,
      dimensions:
        generatedFiles.dimensions,
    });

    /*
     * The existing Cloudinary uploader already supports
     * an interior-and-cover file pair.
     */

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
      !uploadedFiles?.cover?.url ||
      !uploadedFiles?.interior?.md5sum ||
      !uploadedFiles?.cover?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return complete notebook files for item ${itemId}`
      );
    }

    console.log(
      "===== NOTEBOOK CLOUDINARY UPLOAD COMPLETE ====="
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
     * Store the notebook file manifest so the generated
     * files can also be retrieved later by order and item ID.
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
        `The notebook file manifest was not saved correctly for item ${itemId}`
      );
    }

    /*
     * productConfiguration supplies:
     *
     * product: textbook_co_a3_l_fc_ink
     * interior file type: book
     * cover file type: cover
     * total pages: 365
     */

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration.totalPages,

        productConfiguration,
      });

    if (!cloudprinterResult?.success) {
      throw new Error(
        `Cloudprinter did not confirm the notebook order for item ${itemId}`
      );
    }

    return {
      success: true,
      productKind: "notebook",
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,

      totalPages:
        productConfiguration.totalPages,

      coverPages:
        generatedFiles.coverPages,

      manifestUrl:
        storedFiles.manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult.orderReference,

      cloudprinterItemReference:
        cloudprinterResult.itemReference,

      cloudprinterStatus:
        cloudprinterResult.status,
    };
  } finally {
    /*
     * Render uses temporary local storage. Remove both
     * generated PDFs after the Cloudinary upload and
     * Cloudprinter submission are finished.
     */

    if (
      generatedFiles?.interiorPath ||
      generatedFiles?.coverPath
    ) {
      await deleteGeneratedLocalFiles({
        interiorPath:
          generatedFiles.interiorPath,

        coverPath:
          generatedFiles.coverPath,
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| Process calendar
|--------------------------------------------------------------------------
*/

async function processCalendarLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  productConfiguration,
}) {
  const itemId = lineItem.id;
  let generatedFiles = null;

  try {
    console.log(
      `Starting CALENDAR PDF generation for order ${orderNumber}, item ${itemId}`
    );

    generatedFiles =
      await generateCalendarPDFs(
        order,
        lineItem
      );

    if (!generatedFiles?.productPath) {
      throw new Error(
        `Calendar PDF generation did not return productPath for item ${itemId}`
      );
    }

    if (
      Number(generatedFiles.totalPages) !==
      Number(
        productConfiguration.totalPages
      )
    ) {
      throw new Error(
        `Calendar item ${itemId} generated ${generatedFiles.totalPages} pages; expected ${productConfiguration.totalPages}`
      );
    }

    console.log(
      "===== CALENDAR PDF GENERATION COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productKind: "calendar",
      sku: lineItem.sku,
      totalPages:
        generatedFiles.totalPages,
      productPath:
        generatedFiles.productPath,
      dimensions:
        generatedFiles.dimensions,
    });

    const uploadedProduct =
      await uploadCalendarPdf({
        filePath:
          generatedFiles.productPath,

        orderId,
        itemId,
      });

    if (
      !uploadedProduct?.url ||
      !uploadedProduct?.md5sum
    ) {
      throw new Error(
        `Cloudinary did not return a complete calendar product file for item ${itemId}`
      );
    }

    const uploadedFiles = {
      product: uploadedProduct,
    };

    console.log(
      "===== CALENDAR CLOUDINARY UPLOAD COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productUrl:
        uploadedProduct.url,
      productMd5:
        uploadedProduct.md5sum,
    });

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,
        files: [
          uploadedProduct,
        ],
      });

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        `The calendar file manifest was not saved correctly for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,

        totalPages:
          productConfiguration.totalPages,

        productConfiguration,
      });

    if (!cloudprinterResult?.success) {
      throw new Error(
        `Cloudprinter did not confirm the calendar order for item ${itemId}`
      );
    }

    return {
      success: true,
      productKind: "calendar",
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,

      totalPages:
        productConfiguration.totalPages,

      manifestUrl:
        storedFiles.manifestUrl,

      cloudprinterOrderReference:
        cloudprinterResult.orderReference,

      cloudprinterItemReference:
        cloudprinterResult.itemReference,

      cloudprinterStatus:
        cloudprinterResult.status,
    };
  } finally {
    if (generatedFiles?.productPath) {
      await deleteCalendarLocalFile(
        generatedFiles.productPath
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| Resolve and process one line item
|--------------------------------------------------------------------------
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

  console.log(
    `Starting line item ${
      lineItemIndex + 1
    } of ${totalLineItems}`
  );

  const productConfiguration =
    resolveProduct(lineItem);

  console.log({
    orderId,
    orderNumber,
    itemId,
    title: lineItem.title,
    variantTitle:
      lineItem.variant_title,
    sku: lineItem.sku,
    quantity: lineItem.quantity,

    resolvedProductKind:
      productConfiguration.kind,

    cloudprinterProductReference:
      productConfiguration.productReference,
  });

  try {
    if (
      productConfiguration.kind ===
      "calendar"
    ) {
      return await processCalendarLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    if (
      productConfiguration.kind ===
      "notebook"
    ) {
      return await processNotebookLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    if (
      productConfiguration.kind ===
      "journal"
    ) {
      return await processJournalLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
        productConfiguration,
      });
    }

    throw new Error(
      `Unsupported product kind: ${productConfiguration.kind}`
    );
  } catch (error) {
    console.error(
      `Processing failed for line item ${itemId}`
    );

    console.error({
      orderId,
      orderNumber,
      itemId,
      title: lineItem.title,
      sku: lineItem.sku,

      productKind:
        productConfiguration.kind,

      message:
        error.message,

      stack:
        error.stack,
    });

    return {
      success: false,

      productKind:
        productConfiguration.kind,

      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      error: error.message,
    };
  }
}

/*
|--------------------------------------------------------------------------
| Process complete Shopify order
|--------------------------------------------------------------------------
*/

async function processOrderInBackground(order) {
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

  /*
   * Process sequentially to avoid several large PDF generators
   * competing for Render memory at the same time.
   */

  for (
    let index = 0;
    index < validLineItems.length;
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
    totalItems:
      results.length,

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

/*
|--------------------------------------------------------------------------
| POST /shopify/order
|--------------------------------------------------------------------------
*/

router.post(
  "/order",

  express.raw({
    type:
      "application/json",
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
          rawBody:
            req.body,

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
        order =
          JSON.parse(
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

          stack:
            error.stack,
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
          const productConfiguration =
            resolveProduct(
              item
            );

          console.log(
            `Product ${index + 1}:`,
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

              sku:
                item.sku,

              resolvedProductKind:
                productConfiguration.kind,

              productReference:
                productConfiguration
                  .productReference,

              properties:
                item.properties,
            }
          );
        }
      );

      /*
       * Respond to Shopify before generating large PDFs.
       * Shopify receives its successful acknowledgement immediately.
       */

      res
        .status(200)
        .json({
          success: true,

          message:
            "Verified Shopify order accepted",

          orderId,
          orderNumber,

          lineItemCount:
            lineItems.length,
        });

      /*
       * Generate, upload and submit the files after Shopify
       * receives the successful webhook response.
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

        stack:
          error.stack,
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