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

const router = express.Router();

const JOURNAL_TOTAL_PAGES = 366;
const CALENDAR_TOTAL_PAGES = 13;
const CALENDAR_SKU = "CUSTOM-CALENDAR";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSku(value) {
  return clean(value).toUpperCase();
}

function isCalendarLineItem(lineItem) {
  return normalizeSku(lineItem?.sku) === CALENDAR_SKU;
}

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
    receivedBuffer = Buffer.from(receivedHmac, "base64");
    calculatedBuffer = Buffer.from(calculatedHmac, "base64");
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

function isValidLineItem(lineItem) {
  return Boolean(
    lineItem &&
      lineItem.id &&
      Number(lineItem.quantity || 0) > 0
  );
}

async function deleteLocalFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function processCalendarLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
}) {
  const itemId = lineItem.id;
  let generatedFiles = null;

  try {
    console.log(
      "===== HARD CALENDAR ROUTE SELECTED ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      sku: lineItem.sku,
      productKind: "calendar",
    });

    generatedFiles =
      await generateCalendarPDFs(
        order,
        lineItem
      );

    if (!generatedFiles?.productPath) {
      throw new Error(
        `Calendar generator did not return productPath for item ${itemId}`
      );
    }

    if (
      Number(generatedFiles.totalPages) !==
      CALENDAR_TOTAL_PAGES
    ) {
      throw new Error(
        `Calendar generated ${generatedFiles.totalPages} pages instead of ${CALENDAR_TOTAL_PAGES}`
      );
    }

    if (
      generatedFiles.interiorPath ||
      generatedFiles.coverPath
    ) {
      throw new Error(
        "Calendar generator returned journal files. Calendar processing stopped."
      );
    }

    console.log(
      "===== CALENDAR PDF GENERATED ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productPath:
        generatedFiles.productPath,
      totalPages:
        generatedFiles.totalPages,
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
        `Calendar upload did not return a URL and MD5 checksum for item ${itemId}`
      );
    }

    console.log(
      "===== CALENDAR FILE UPLOADED ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      fileType:
        uploadedProduct.type,
      calendarUrl:
        uploadedProduct.url,
      publicId:
        uploadedProduct.publicId,
    });

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,
        productKind:
          "calendar",
        files: [
          uploadedProduct,
        ],
      });

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        `Calendar manifest was not saved for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles: {
          product:
            uploadedProduct,
        },
        totalPages:
          CALENDAR_TOTAL_PAGES,
        productKind:
          "calendar",
      });

    if (!cloudprinterResult?.success) {
      throw new Error(
        `Cloudprinter did not confirm the calendar order for item ${itemId}`
      );
    }

    console.log(
      "===== CALENDAR CLOUDPRINTER ORDER COMPLETE ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      productKind:
        "calendar",
      productReference:
        cloudprinterResult.productReference,
      orderReference:
        cloudprinterResult.orderReference,
      status:
        cloudprinterResult.status,
    });

    return {
      success: true,
      productKind:
        "calendar",
      itemId,
      totalPages:
        CALENDAR_TOTAL_PAGES,
      manifestUrl:
        storedFiles.manifestUrl,
      cloudprinterOrderReference:
        cloudprinterResult.orderReference,
    };
  } finally {
    if (generatedFiles?.productPath) {
      try {
        await deleteLocalFile(
          generatedFiles.productPath
        );
      } catch (cleanupError) {
        console.error(
          "Unable to delete calendar temporary file",
          cleanupError
        );
      }
    }
  }
}

async function processJournalLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
}) {
  const itemId = lineItem.id;
  let generatedFiles = null;

  try {
    console.log(
      "===== JOURNAL ROUTE SELECTED ====="
    );

    console.log({
      orderId,
      orderNumber,
      itemId,
      sku: lineItem.sku,
      productKind: "journal",
    });

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
        `Journal generator did not return interior and cover for item ${itemId}`
      );
    }

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
        `Journal upload did not return both files for item ${itemId}`
      );
    }

    const storedFiles =
      await saveOrderFiles({
        orderId,
        orderNumber,
        itemId,
        productKind:
          "journal",
        files: [
          uploadedFiles.interior,
          uploadedFiles.cover,
        ],
      });

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        `Journal manifest was not saved for item ${itemId}`
      );
    }

    const cloudprinterResult =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,
        totalPages:
          JOURNAL_TOTAL_PAGES,
        productKind:
          "journal",
      });

    if (!cloudprinterResult?.success) {
      throw new Error(
        `Cloudprinter did not confirm the journal order for item ${itemId}`
      );
    }

    console.log(
      "===== JOURNAL CLOUDPRINTER ORDER COMPLETE ====="
    );

    return {
      success: true,
      productKind:
        "journal",
      itemId,
      totalPages:
        JOURNAL_TOTAL_PAGES,
      manifestUrl:
        storedFiles.manifestUrl,
      cloudprinterOrderReference:
        cloudprinterResult.orderReference,
    };
  } finally {
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
      } catch (cleanupError) {
        console.error(
          "Unable to delete journal temporary files",
          cleanupError
        );
      }
    }
  }
}

async function processLineItem({
  order,
  orderId,
  orderNumber,
  lineItem,
  lineItemIndex,
  totalLineItems,
}) {
  const itemId = lineItem.id;
  const sku = normalizeSku(
    lineItem.sku
  );

  console.log(
    `Starting line item ${
      lineItemIndex + 1
    } of ${totalLineItems}`
  );

  console.log({
    orderId,
    orderNumber,
    itemId,
    title:
      lineItem.title,
    sku,
    quantity:
      lineItem.quantity,
  });

  try {
    if (sku === CALENDAR_SKU) {
      return await processCalendarLineItem({
        order,
        orderId,
        orderNumber,
        lineItem,
      });
    }

    return await processJournalLineItem({
      order,
      orderId,
      orderNumber,
      lineItem,
    });
  } catch (error) {
    console.error(
      `Processing failed for line item ${itemId}`
    );

    console.error({
      orderId,
      orderNumber,
      itemId,
      sku,
      message:
        error.message,
      stack:
        error.stack,
    });

    return {
      success: false,
      itemId,
      sku,
      error:
        error.message,
    };
  }
}

async function processOrderInBackground(
  order
) {
  const orderId = order.id;

  const orderNumber =
    order.order_number ||
    order.id ||
    Date.now();

  const allLineItems =
    Array.isArray(order.line_items)
      ? order.line_items
      : [];

  const validLineItems =
    allLineItems.filter(
      isValidLineItem
    );

  if (validLineItems.length === 0) {
    throw new Error(
      "The Shopify order does not contain valid line items"
    );
  }

  const results = [];

  for (
    let index = 0;
    index < validLineItems.length;
    index += 1
  ) {
    const result =
      await processLineItem({
        order,
        orderId,
        orderNumber,
        lineItem:
          validLineItems[index],
        lineItemIndex:
          index,
        totalLineItems:
          validLineItems.length,
      });

    results.push(result);
  }

  console.log(
    "===== ORDER PROCESSING SUMMARY ====="
  );

  console.log({
    orderId,
    orderNumber,
    results,
  });
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

      if (
        !shopifyHmac ||
        !webhookSecret
      ) {
        return res
          .status(401)
          .json({
            success: false,
            message:
              "Unauthorized",
          });
      }

      if (!Buffer.isBuffer(req.body)) {
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
          req.body.toString("utf8")
        );
      } catch (error) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid JSON",
          });
      }

      if (!order?.id) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid Shopify order",
          });
      }

      const lineItems =
        Array.isArray(order.line_items)
          ? order.line_items
          : [];

      console.log(
        "===== SHOPIFY ORDER RECEIVED ====="
      );

      lineItems.forEach(
        (item, index) => {
          console.log({
            index:
              index + 1,
            itemId:
              item.id,
            title:
              item.title,
            sku:
              item.sku,
            normalizedSku:
              normalizeSku(item.sku),
            isCalendar:
              isCalendarLineItem(item),
          });
        }
      );

      res.status(200).json({
        success: true,
        message:
          "Verified Shopify order accepted",
        orderId:
          order.id,
        lineItemCount:
          lineItems.length,
      });

      setImmediate(() => {
        processOrderInBackground(
          order
        ).catch((error) => {
          console.error(
            "Background order processing failed",
            error
          );
        });
      });

      return;
    } catch (error) {
      console.error(
        "Shopify webhook processing failed",
        error
      );

      if (!res.headersSent) {
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