
"use strict";

/*
 * Fresh Start Paper — Shopify Order Routes
 *
 * Fulfillment provider: Lulu Print API
 *
 * Preserves:
 * - Shopify HMAC verification
 * - Custom journal PDF generation
 * - Custom notebook PDF generation
 * - Cloudinary uploads
 * - Download manifests
 * - Manual paid-order recovery
 *
 * Calendars remain blocked from Lulu fulfillment
 * until Lulu-compatible print files are available.
 *
 * Important:
 * LULU_ENABLED must remain false until testing
 * and print specifications are verified.
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const axios = require("axios");

const {
  generateJournalPDFs,
} = require("../services/pdfGenerator");

const {
  generateNotebookPDFs,
} = require("../services/notebookPdfGenerator");

const {
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
} = require("../services/cloudinaryService");

const {
  saveOrderFiles,
  getOrderFiles,
} = require("../services/orderFileStore");

const {
  submitLuluOrder,
} = require("../services/luluService");

const {
  resolveProduct,
} = require("../services/productResolver");

const router = express.Router();

const SHOPIFY_ADMIN_API_VERSION = "2026-07";

let recoveryToken = null;
let recoveryTokenExpiresAt = 0;

const ordersInProgress = new Set();

/*
 * --------------------------------------------------
 * GENERAL HELPERS
 * --------------------------------------------------
 */

function clean(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function normalizeStore(value) {
  return clean(value)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function numericId(value) {
  const result = clean(value).split("/").pop();

  if (!/^\d+$/.test(result)) {
    throw new Error(
      `Invalid Shopify numeric ID: ${value}`
    );
  }

  return result;
}

function safeEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function verifyShopifyWebhook(
  rawBody,
  hmac,
  secret
) {
  if (!Buffer.isBuffer(rawBody)) {
    return false;
  }

  if (!hmac || !secret) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  return safeEqual(hmac, expected);
}

function isValidLineItem(item) {
  return Boolean(
    item &&
    item.id &&
    Number(item.quantity) > 0
  );
}

function orderNumberOf(order) {
  return (
    order.order_number ||
    order.name ||
    order.id
  );
}

function isPaid(order) {
  return clean(
    order.financial_status
  ).toLowerCase() === "paid";
}

/*
 * --------------------------------------------------
 * PRODUCT RESOLUTION
 * --------------------------------------------------
 */

function getProductConfiguration(lineItem) {
  const configuration = resolveProduct(lineItem);

  if (!configuration?.kind) {
    throw new Error(
      `Unable to resolve product: ${lineItem.title}`
    );
  }

  if (
    !["journal", "notebook", "calendar"]
      .includes(configuration.kind)
  ) {
    throw new Error(
      `Unsupported product: ${configuration.kind}`
    );
  }

  return configuration;
}

/*
 * --------------------------------------------------
 * EXISTING MANIFEST LOOKUP
 * --------------------------------------------------
 */

async function existingManifest(orderId, itemId) {
  try {
    const manifest = await getOrderFiles({
      orderId,
      itemId,
    });

    if (
      manifest &&
      Array.isArray(manifest.files) &&
      manifest.files.length > 0
    ) {
      return manifest;
    }

    return null;
  } catch (error) {
    console.log(
      "Manifest lookup unavailable:",
      error.message
    );

    // Fail closed for recovery: an unavailable
    // manifest store cannot prove that an
    // order has not already been processed.
    throw error;
  }
}

async function findExistingOrderFiles(order) {
  const matches = [];

  for (const item of order.line_items || []) {
    const manifest = await existingManifest(
      order.id,
      item.id
    );

    if (manifest) {
      matches.push({
        itemId: item.id,
        title: item.title,
        manifest,
      });
    }
  }

  return matches;
}

/*
 * --------------------------------------------------
 * PDF UPLOAD VALIDATION
 * --------------------------------------------------
 */

function validateUploadedFiles(files, kind) {
  for (const type of ["interior", "cover"]) {
    const file = files?.[type];

    if (!file?.url) {
      throw new Error(
        `${kind}: missing ${type} Cloudinary URL`
      );
    }

    if (
      !/^[a-f0-9]{32}$/i.test(
        clean(file.md5sum)
      )
    ) {
      throw new Error(
        `${kind}: invalid ${type} PDF MD5`
      );
    }

    if (
      !/^https:\/\//i.test(file.url)
    ) {
      throw new Error(
        `${kind}: ${type} URL must use HTTPS`
      );
    }
  }
}

/*
 * --------------------------------------------------
 * LULU SAFETY CHECKS
 * --------------------------------------------------
 */

function verifyLuluConfiguration(kind) {
  if (
    process.env.LULU_ENABLED !== "true"
  ) {
    throw new Error(
      "Lulu fulfillment is disabled. " +
      "Set LULU_ENABLED=true only after testing."
    );
  }

  if (kind === "calendar") {
    throw new Error(
      "Calendar Lulu submission blocked. " +
      "The current 13-page calendar uses a " +
      "single PDF and requires conversion."
    );
  }

  const variable =
    kind === "journal"
      ? "LULU_JOURNAL_PACKAGE_ID"
      : "LULU_NOTEBOOK_PACKAGE_ID";

  if (!process.env[variable]) {
    throw new Error(
      `${variable} is missing from Render.`
    );
  }
}

/*
 * --------------------------------------------------
 * PROCESS JOURNAL
 * --------------------------------------------------
 */

async function processJournalLineItem({
  order,
  lineItem,
  productConfiguration,
}) {
  const orderId = order.id;
  const itemId = lineItem.id;

  let generatedFiles = null;

  try {
    verifyLuluConfiguration("journal");

    console.log(
      "===== JOURNAL GENERATION STARTED =====",
      { orderId, itemId }
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
        "Journal generator did not produce " +
        "both interior and cover files."
      );
    }

    const uploadedFiles =
      await uploadGeneratedPDFs({
        interiorPath: generatedFiles.interiorPath,
        coverPath: generatedFiles.coverPath,
        orderId,
        itemId,
      });

    validateUploadedFiles(
      uploadedFiles,
      "journal"
    );

    const storedFiles = await saveOrderFiles({
      orderId,
      orderNumber: orderNumberOf(order),
      itemId,
      files: [
        uploadedFiles.interior,
        uploadedFiles.cover,
      ],
    });

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        "Journal manifest was not saved."
      );
    }

    console.log(
      "===== JOURNAL LULU SUBMISSION =====",
      { orderId, itemId }
    );

    const luluResult = await submitLuluOrder({
      order,
      lineItem,
      uploadedFiles,
      productKind: "journal",
      productConfiguration,
    });

    if (!luluResult?.id) {
      throw new Error(
        "Lulu did not return a journal print-job ID."
      );
    }

    return {
      success: true,
      productKind: "journal",
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      totalPages: productConfiguration.totalPages,
      manifestUrl: storedFiles.manifestUrl,
      luluJobId: luluResult.id,
      luluLineItemId: String(itemId),
      luluStatus:
        luluResult.status?.name ||
        luluResult.status ||
        "CREATED",
    };
  } finally {
    if (generatedFiles) {
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
 * --------------------------------------------------
 * PROCESS NOTEBOOK
 * --------------------------------------------------
 */

async function processNotebookLineItem({
  order,
  lineItem,
  productConfiguration,
}) {
  const orderId = order.id;
  const itemId = lineItem.id;

  let generatedFiles = null;

  try {
    verifyLuluConfiguration("notebook");

    console.log(
      "===== NOTEBOOK GENERATION STARTED =====",
      { orderId, itemId }
    );

    generatedFiles = await generateNotebookPDFs(
      order,
      lineItem
    );

    if (
      !generatedFiles?.interiorPath ||
      !generatedFiles?.coverPath
    ) {
      throw new Error(
        "Notebook generator did not produce " +
        "both interior and cover files."
      );
    }

    if (
      Number(generatedFiles.totalPages) !==
      Number(productConfiguration.totalPages)
    ) {
      throw new Error(
        `Notebook generated ${generatedFiles.totalPages} ` +
        `pages; expected ${productConfiguration.totalPages}.`
      );
    }

    if (
      Number(generatedFiles.coverPages) !== 2
    ) {
      throw new Error(
        "Notebook generator did not report " +
        "the expected 2 cover pages."
      );
    }

    const uploadedFiles =
      await uploadGeneratedPDFs({
        interiorPath: generatedFiles.interiorPath,
        coverPath: generatedFiles.coverPath,
        orderId,
        itemId,
      });

    validateUploadedFiles(
      uploadedFiles,
      "notebook"
    );

    const storedFiles = await saveOrderFiles({
      orderId,
      orderNumber: orderNumberOf(order),
      itemId,
      files: [
        uploadedFiles.interior,
        uploadedFiles.cover,
      ],
    });

    if (!storedFiles?.manifestUrl) {
      throw new Error(
        "Notebook manifest was not saved."
      );
    }

    const luluResult = await submitLuluOrder({
      order,
      lineItem,
      uploadedFiles,
      productKind: "notebook",
      productConfiguration,
    });

    if (!luluResult?.id) {
      throw new Error(
        "Lulu did not return a notebook print-job ID."
      );
    }

    return {
      success: true,
      productKind: "notebook",
      itemId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      totalPages: productConfiguration.totalPages,
      coverPages: generatedFiles.coverPages,
      manifestUrl: storedFiles.manifestUrl,
      luluJobId: luluResult.id,
      luluLineItemId: String(itemId),
      luluStatus:
        luluResult.status?.name ||
        luluResult.status ||
        "CREATED",
    };
  } finally {
    if (generatedFiles) {
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
 * --------------------------------------------------
 * PROCESS CALENDAR
 * --------------------------------------------------
 */

async function processCalendarLineItem() {
  throw new Error(
    "Calendar Lulu fulfillment is not ready. " +
    "Its existing single PDF must be converted " +
    "to Lulu-compatible cover and interior files."
  );
}

/*
 * --------------------------------------------------
 * PROCESS INDIVIDUAL LINE ITEM
 * --------------------------------------------------
 */

async function processLineItem({
  order,
  lineItem,
  lineItemIndex,
  totalLineItems,
}) {
  let kind = "unknown";

  try {
    const productConfiguration =
      getProductConfiguration(lineItem);

    kind = productConfiguration.kind;

    console.log(
      `Processing item ${lineItemIndex + 1} ` +
      `of ${totalLineItems}`,
      {
        orderId: order.id,
        itemId: lineItem.id,
        kind,
        sku: lineItem.sku,
      }
    );

    if (kind === "journal") {
      return await processJournalLineItem({
        order,
        lineItem,
        productConfiguration,
      });
    }

    if (kind === "notebook") {
      return await processNotebookLineItem({
        order,
        lineItem,
        productConfiguration,
      });
    }

    if (kind === "calendar") {
      return await processCalendarLineItem({
        order,
        lineItem,
        productConfiguration,
      });
    }

    throw new Error(
      `Unsupported product kind: ${kind}`
    );
  } catch (error) {
    console.error(
      "LINE ITEM FAILED",
      {
        orderId: order.id,
        itemId: lineItem.id,
        kind,
        message: error.message,
        stack: error.stack,
      }
    );

    return {
      success: false,
      productKind: kind,
      itemId: lineItem.id,
      title: lineItem.title,
      quantity: lineItem.quantity,
      error: error.message,
    };
  }
}

/*
 * --------------------------------------------------
 * PROCESS COMPLETE SHOPIFY ORDER
 * --------------------------------------------------
 */

async function processOrderInBackground(order) {
  const orderId = order.id;
  const orderNumber = orderNumberOf(order);

  if (
    !orderId ||
    !Array.isArray(order.line_items)
  ) {
    throw new Error(
      "Invalid Shopify order payload."
    );
  }

  if (!isPaid(order)) {
    throw new Error(
      `Order ${orderNumber} is not marked PAID.`
    );
  }

  const lockKey = String(orderId);

  if (ordersInProgress.has(lockKey)) {
    throw new Error(
      `Order ${orderNumber} is already processing.`
    );
  }

  ordersInProgress.add(lockKey);

  try {
    const validItems =
      order.line_items.filter(isValidLineItem);

    if (!validItems.length) {
      throw new Error(
        "No valid order line items."
      );
    }

    const results = [];

    // Sequential processing protects Render memory.
    for (
      let index = 0;
      index < validItems.length;
      index += 1
    ) {
      const lineItem = validItems[index];

      const result = await processLineItem({
        order,
        lineItem,
        lineItemIndex: index,
        totalLineItems: validItems.length,
      });

      results.push(result);
    }

    const successfulItems =
      results.filter(item => item.success);

    const failedItems =
      results.filter(item => !item.success);

    console.log(
      "===== LULU ORDER SUMMARY =====",
      {
        orderId,
        orderNumber,
        successful: successfulItems.length,
        failed: failedItems.length,
        results,
      }
    );

    return {
      results,
      successfulItems,
      failedItems,
      allSucceeded: failedItems.length === 0,
    };
  } finally {
    ordersInProgress.delete(lockKey);
  }
}

/*
 * --------------------------------------------------
 * SHOPIFY RECOVERY ACCESS TOKEN
 * --------------------------------------------------
 */

async function getRecoveryShopifyAccessToken() {
  if (
    recoveryToken &&
    Date.now() < recoveryTokenExpiresAt
  ) {
    return recoveryToken;
  }

  const store = normalizeStore(
    process.env.SHOPIFY_STORE
  );

  const clientId = clean(
    process.env.SHOPIFY_CLIENT_ID
  );

  const clientSecret = clean(
    process.env.SHOPIFY_CLIENT_SECRET
  );

  if (!store || !clientId || !clientSecret) {
    throw new Error(
      "Shopify recovery credentials are missing."
    );
  }

  const response = await axios.post(
    `https://${store}/admin/oauth/access_token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    {
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      timeout: 15000,
    }
  );

  recoveryToken = response.data?.access_token;

  if (!recoveryToken) {
    throw new Error(
      "Shopify did not issue an access token."
    );
  }

  const expiresIn = Number(
    response.data?.expires_in || 86399
  );

  recoveryTokenExpiresAt =
    Date.now() +
    Math.max(expiresIn - 300, 60) * 1000;

  return recoveryToken;
}

/*
 * --------------------------------------------------
 * SHOPIFY GRAPHQL CONVERSION
 * --------------------------------------------------
 */

function convertGraphqlAddress(address) {
  if (!address) {
    return null;
  }

  return {
    first_name: address.firstName || "",
    last_name: address.lastName || "",
    company: address.company || "",
    address1: address.address1 || "",
    address2: address.address2 || "",
    city: address.city || "",
    zip: address.zip || "",
    province: address.province || "",
    province_code: address.provinceCode || "",
    country: address.country || "",
    country_code: address.countryCodeV2 || "",
    phone: address.phone || "",
  };
}

function convertGraphqlLineItem(item) {
  return {
    id: numericId(item.id),
    product_id: null,
    variant_id: null,
    title: item.title || item.name,
    name: item.name || item.title,
    quantity: Number(item.quantity || 1),
    sku: item.sku || "",
    variant_title: item.variantTitle || "",
    properties: (item.customAttributes || [])
      .map(attribute => ({
        name: attribute.key,
        value: attribute.value,
      })),
  };
}

function convertGraphqlOrder(data) {
  const shippingAddress =
    convertGraphqlAddress(data.shippingAddress);

  const billingAddress =
    convertGraphqlAddress(data.billingAddress);

  const address =
    shippingAddress || billingAddress;

  const orderName = clean(data.name);

  return {
    id: numericId(
      data.legacyResourceId || data.id
    ),

    name: orderName,

    order_number:
      orderName.replace(/^#/, ""),

    email: data.email || "",
    contact_email: data.email || "",

    created_at: data.createdAt || null,

    financial_status:
      clean(data.displayFinancialStatus)
        .toLowerCase(),

    fulfillment_status: null,

    shipping_address: shippingAddress,
    billing_address: billingAddress,

    phone:
      shippingAddress?.phone ||
      billingAddress?.phone ||
      "",

    customer: address
      ? {
          first_name: address.first_name,
          last_name: address.last_name,
          email: data.email || "",
          phone: address.phone || "",
        }
      : null,

    line_items:
      (data.lineItems?.nodes || [])
        .map(convertGraphqlLineItem),
  };
}

/*
 * --------------------------------------------------
 * LOOK UP AN EXISTING SHOPIFY ORDER
 * --------------------------------------------------
 */

async function findShopifyOrderForRecovery(
  orderNumber
) {
  const store = normalizeStore(
    process.env.SHOPIFY_STORE
  );

  const token =
    await getRecoveryShopifyAccessToken();

  const query = `
    query RecoverOrder($searchQuery: String!) {
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
          createdAt
          cancelledAt
          displayFinancialStatus

          shippingAddress {
            firstName
            lastName
            company
            address1
            address2
            city
            zip
            province
            provinceCode
            country
            countryCodeV2
            phone
          }

          billingAddress {
            firstName
            lastName
            company
            address1
            address2
            city
            zip
            province
            provinceCode
            country
            countryCodeV2
            phone
          }

          lineItems(first: 100) {
            nodes {
              id
              title
              name
              quantity
              sku
              variantTitle

              customAttributes {
                key
                value
              }
            }
          }
        }
      }
    }
  `;

  const normalized = clean(orderNumber)
    .replace(/^#/, "");

  const response = await axios.post(
    `https://${store}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      query,
      variables: {
        searchQuery: `name:#${normalized}`,
      },
    },
    {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  if (response.data?.errors?.length) {
    throw new Error(
      response.data.errors
        .map(error => error.message)
        .join("; ")
    );
  }

  const orders =
    response.data?.data?.orders?.nodes;

  if (!Array.isArray(orders)) {
    throw new Error(
      "Shopify returned an invalid order response."
    );
  }

  return orders.find(
    order =>
      clean(order.name).replace(/^#/, "") ===
      normalized
  ) || null;
}

/*
 * --------------------------------------------------
 * POST /shopify/reprocess
 * --------------------------------------------------
 *
 * Reprocesses an existing paid Shopify order.
 * Does not charge the customer.
 */

router.post(
  "/reprocess",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const expectedSecret = clean(
        process.env.ORDER_REPROCESS_SECRET
      );

      if (!expectedSecret) {
        return res.status(500).json({
          success: false,
          message:
            "ORDER_REPROCESS_SECRET is missing.",
        });
      }

      if (
        !safeEqual(
          req.get("X-Reprocess-Secret"),
          expectedSecret
        )
      ) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const orderNumber = clean(
        req.body?.orderNumber
      ).replace(/^#/, "");

      if (!orderNumber) {
        return res.status(400).json({
          success: false,
          message: "orderNumber is required.",
        });
      }

      const graphqlOrder =
        await findShopifyOrderForRecovery(
          orderNumber
        );

      if (!graphqlOrder) {
        return res.status(404).json({
          success: false,
          message: "Shopify order not found.",
        });
      }

      if (graphqlOrder.cancelledAt) {
        return res.status(409).json({
          success: false,
          message:
            "Cancelled orders cannot be recovered.",
        });
      }

      if (
        clean(
          graphqlOrder.displayFinancialStatus
        ).toUpperCase() !== "PAID"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Only PAID orders can be recovered.",
        });
      }

      const order =
        convertGraphqlOrder(graphqlOrder);

      const existing =
        await findExistingOrderFiles(order);

      if (existing.length) {
        return res.status(409).json({
          success: false,
          message:
            "Generated files already exist. " +
            "Recovery stopped to avoid duplicates.",
          existingItems: existing.map(item => ({
            itemId: item.itemId,
            title: item.title,
          })),
        });
      }

      if (
        process.env.LULU_ENABLED !== "true"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Lulu is disabled. Recovery will not " +
            "submit a print job.",
        });
      }

      if (
        ordersInProgress.has(String(order.id))
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This order is already processing.",
        });
      }

      res.status(202).json({
        success: true,
        message:
          `Order #${orderNumber} accepted for recovery.`,
        orderId: order.id,
        lineItemCount: order.line_items.length,
      });

      setImmediate(() => {
        processOrderInBackground(order)
          .then(summary => {
            console.log(
              "RECOVERY RESULT",
              {
                orderNumber,
                allSucceeded: summary.allSucceeded,
                failedItems: summary.failedItems,
              }
            );
          })
          .catch(error => {
            console.error(
              "RECOVERY FAILED",
              error
            );
          });
      });

      return;
    } catch (error) {
      console.error(
        "Shopify recovery error:",
        error
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    }
  }
);

/*
 * --------------------------------------------------
 * POST /shopify/order
 * --------------------------------------------------
 *
 * Shopify order webhook.
 *
 * IMPORTANT:
 * Must receive an unmodified raw request body.
 */

router.post(
  "/order",
  express.raw({
    type: "application/json",
  }),
  async (req, res) => {
    try {
      const hmac = req.get(
        "X-Shopify-Hmac-Sha256"
      );

      const secret =
        process.env.SHOPIFY_WEBHOOK_SECRET;

      if (
        !verifyShopifyWebhook(
          req.body,
          hmac,
          secret
        )
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid Shopify webhook signature.",
        });
      }

      let order;

      try {
        order = JSON.parse(
          req.body.toString("utf8")
        );
      } catch {
        return res.status(400).json({
          success: false,
          message: "Invalid Shopify JSON.",
        });
      }

      if (!order?.id) {
        return res.status(400).json({
          success: false,
          message:
            "Missing Shopify order ID.",
        });
      }

      if (!isPaid(order)) {
        return res.status(200).json({
          success: true,
          message:
            "Order acknowledged; not paid. " +
            "Fulfillment was not started.",
        });
      }

      if (
        process.env.LULU_ENABLED !== "true"
      ) {
        console.warn(
          "Lulu is disabled. " +
          "Shopify order will not be submitted.",
          { orderId: order.id }
        );

        return res.status(200).json({
          success: true,
          message:
            "Order verified. Lulu fulfillment disabled.",
          orderId: order.id,
        });
      }

      console.log(
        "===== VERIFIED SHOPIFY ORDER =====",
        {
          orderId: order.id,
          orderNumber: orderNumberOf(order),
          lineItemCount:
            order.line_items?.length || 0,
        }
      );

      // Respond quickly to Shopify, then process.
      res.status(200).json({
        success: true,
        message:
          "Shopify order accepted for Lulu processing.",
        orderId: order.id,
        orderNumber: orderNumberOf(order),
      });

      setImmediate(() => {
        processOrderInBackground(order)
          .then(summary => {
            console.log(
              "SHOPIFY ORDER COMPLETE",
              {
                orderId: order.id,
                allSucceeded: summary.allSucceeded,
                failedItems: summary.failedItems,
              }
            );
          })
          .catch(error => {
            console.error(
              "SHOPIFY PROCESSING FAILED",
              {
                orderId: order.id,
                message: error.message,
                stack: error.stack,
              }
            );
          });
      });

      return;
    } catch (error) {
      console.error(
        "Shopify webhook failure:",
        error
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: "Order processing failed.",
        });
      }
    }
  }
);

module.exports = router;
