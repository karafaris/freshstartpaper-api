const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function getRequiredEnvironmentVariable(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function sanitizePathPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function calculateMd5(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);

  return crypto
    .createHash("md5")
    .update(fileBuffer)
    .digest("hex");
}

function validateCloudinaryConfiguration() {
  getRequiredEnvironmentVariable("CLOUDINARY_CLOUD_NAME");
  getRequiredEnvironmentVariable("CLOUDINARY_API_KEY");
  getRequiredEnvironmentVariable("CLOUDINARY_API_SECRET");
}

function validateCalendarPdf(filePath) {
  validateCloudinaryConfiguration();

  if (!filePath) {
    throw new Error("Calendar PDF path is required");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Calendar PDF does not exist: ${filePath}`);
  }

  if (path.extname(filePath).toLowerCase() !== ".pdf") {
    throw new Error("Calendar file must be a PDF");
  }
}

async function uploadCalendarPdf({
  filePath,
  orderId,
  itemId,
}) {
  validateCalendarPdf(filePath);

  const safeOrderId = sanitizePathPart(orderId);
  const safeItemId = sanitizePathPart(itemId);

  if (!safeOrderId) {
    throw new Error("orderId is required");
  }

  if (!safeItemId) {
    throw new Error("itemId is required");
  }

  const folder = [
    "fresh-start-paper",
    "calendar-tests",
    `order-${safeOrderId}`,
    `item-${safeItemId}`,
  ].join("/");

  const publicId = `${folder}/product`;

  const md5sum = await calculateMd5(filePath);

  console.log("Uploading calendar PDF to Cloudinary...");
  console.log(`Local file: ${filePath}`);
  console.log(`Cloudinary public ID: ${publicId}`);

  const uploadResult = await cloudinary.uploader.upload(
    filePath,
    {
      resource_type: "raw",
      type: "upload",
      public_id: publicId,
      format: "pdf",
      overwrite: true,
      invalidate: true,
      use_filename: false,
      unique_filename: false,
    }
  );

  if (!uploadResult?.secure_url) {
    throw new Error(
      "Cloudinary did not return a secure URL"
    );
  }

  return {
    type: "product",
    format: "pdf",
    url: uploadResult.secure_url,
    secureUrl: uploadResult.secure_url,
    md5sum,
    publicId: uploadResult.public_id,
    bytes: uploadResult.bytes,
    createdAt: uploadResult.created_at,
  };
}

module.exports = {
  uploadCalendarPdf,
};