const axios = require("axios");

const {
  uploadJson,
} = require("./cloudinaryService");

function sanitizePublicId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/-+/g, "-");
}

function buildManifestUrl(orderId, itemId) {
  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME is not configured"
    );
  }

  const safeOrderId = sanitizePublicId(orderId);
  const safeItemId = sanitizePublicId(itemId);

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

async function saveOrderFiles({
  orderId,
  orderNumber,
  itemId,
  files,
}) {
  if (!orderId || !itemId) {
    throw new Error(
      "orderId and itemId are required"
    );
  }

  const manifest = {
    orderId: String(orderId),
    orderNumber:
      orderNumber !== undefined
        ? String(orderNumber)
        : null,
    itemId: String(itemId),
    status: "ready",
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({
      type: file.type,
      url: file.url,
      md5sum: file.md5sum,
    })),
  };

  const uploadedManifest = await uploadJson({
    data: manifest,
    orderId,
    itemId,
  });

  return {
    ...manifest,
    manifestUrl: uploadedManifest.url,
  };
}

async function getOrderFiles({
  orderId,
  itemId,
}) {
  const manifestUrl = buildManifestUrl(
    orderId,
    itemId
  );

  try {
    const response = await axios.get(
      manifestUrl,
      {
        timeout: 3500,
        responseType: "json",
        headers: {
          Accept: "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
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
};