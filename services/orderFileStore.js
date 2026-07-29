const axios = require("axios");

const {
  uploadJson,
} = require("./cloudinaryService");

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function cleanString(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const cleaned =
    String(value).trim();

  return cleaned || fallback;
}

function normalizeProductKind(value) {
  const normalized =
    cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (
    [
      "journal",
      "notebook",
      "calendar",
    ].includes(normalized)
  ) {
    return normalized;
  }

  return null;
}

function sanitizePublicId(value) {
  return String(value || "")
    .trim()
    .replace(
      /[^a-zA-Z0-9/_-]/g,
      "-"
    )
    .replace(/-+/g, "-");
}

/*
|--------------------------------------------------------------------------
| Manifest URL
|--------------------------------------------------------------------------
*/

function buildManifestUrl(
  orderId,
  itemId
) {
  const cloudName =
    process.env
      .CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME is not configured"
    );
  }

  const safeOrderId =
    sanitizePublicId(orderId);

  const safeItemId =
    sanitizePublicId(itemId);

  return [
    `https://res.cloudinary.com/${cloudName}`,
    "raw",
    "upload",
    "fresh-start-paper",
    "manifests",
    `order-${safeOrderId}`,
    `item-${safeItemId}.json`,
  ].join("/");
}

/*
|--------------------------------------------------------------------------
| Save generated files
|--------------------------------------------------------------------------
|
| The extra metadata fields are optional so existing journal and calendar
| calls remain compatible.
|
*/

async function saveOrderFiles({
  orderId,
  orderNumber,
  itemId,
  files,

  productKind = null,
  productReference = null,
  productTitle = null,
  sku = null,
  totalPages = null,
}) {
  if (!orderId || !itemId) {
    throw new Error(
      "orderId and itemId are required"
    );
  }

  if (
    !Array.isArray(files) ||
    files.length === 0
  ) {
    throw new Error(
      "At least one generated file is required"
    );
  }

  const normalizedFiles =
    files
      .filter(Boolean)
      .map((file) => ({
        type:
          cleanString(
            file.type
          ),

        url:
          cleanString(
            file.url ||
              file.secureUrl ||
              file.secure_url
          ),

        md5sum:
          cleanString(
            file.md5sum
          ),
      }))
      .filter(
        (file) =>
          file.type &&
          file.url
      );

  if (
    normalizedFiles.length === 0
  ) {
    throw new Error(
      "No usable generated files were supplied"
    );
  }

  const normalizedProductKind =
    normalizeProductKind(
      productKind
    );

  const manifest = {
    manifestVersion: 2,

    orderId:
      String(orderId),

    orderNumber:
      orderNumber !==
      undefined
        ? String(orderNumber)
        : null,

    itemId:
      String(itemId),

    productKind:
      normalizedProductKind,

    productReference:
      cleanString(
        productReference
      ) || null,

    productTitle:
      cleanString(
        productTitle
      ) || null,

    sku:
      cleanString(sku) ||
      null,

    totalPages:
      Number.isInteger(
        Number(totalPages)
      )
        ? Number(totalPages)
        : null,

    status:
      "ready",

    createdAt:
      new Date().toISOString(),

    files:
      normalizedFiles,
  };

  const uploadedManifest =
    await uploadJson({
      data:
        manifest,

      orderId,
      itemId,
    });

  return {
    ...manifest,

    manifestUrl:
      uploadedManifest.url,
  };
}

/*
|--------------------------------------------------------------------------
| Retrieve generated files
|--------------------------------------------------------------------------
*/

async function getOrderFiles({
  orderId,
  itemId,
}) {
  const manifestUrl =
    buildManifestUrl(
      orderId,
      itemId
    );

  try {
    const response =
      await axios.get(
        manifestUrl,
        {
          timeout: 5000,

          responseType:
            "json",

          headers: {
            Accept:
              "application/json",
          },
        }
      );

    if (
      !response.data ||
      typeof response.data !==
        "object"
    ) {
      return null;
    }

    return {
      ...response.data,
      manifestUrl,
    };
  } catch (error) {
    if (
      error.response?.status ===
      404
    ) {
      return null;
    }

    throw new Error(
      `Unable to retrieve file manifest: ${error.message}`
    );
  }
}

module.exports = {
  saveOrderFiles,
  getOrderFiles,
  buildManifestUrl,
};