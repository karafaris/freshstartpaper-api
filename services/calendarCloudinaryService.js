const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name:
    process.env.CLOUDINARY_CLOUD_NAME,
  api_key:
    process.env.CLOUDINARY_API_KEY,
  api_secret:
    process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function requireEnvironmentVariable(name) {
  const value = String(
    process.env[name] || ""
  ).trim();

  if (!value) {
    throw new Error(
      `${name} is not configured`
    );
  }

  return value;
}

function sanitizePathPart(value) {
  return String(value || "")
    .trim()
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    )
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function calculateMd5(filePath) {
  const fileBuffer =
    await fs.promises.readFile(
      filePath
    );

  return crypto
    .createHash("md5")
    .update(fileBuffer)
    .digest("hex");
}

function validateCalendarPdf(filePath) {
  requireEnvironmentVariable(
    "CLOUDINARY_CLOUD_NAME"
  );

  requireEnvironmentVariable(
    "CLOUDINARY_API_KEY"
  );

  requireEnvironmentVariable(
    "CLOUDINARY_API_SECRET"
  );

  if (!filePath) {
    throw new Error(
      "Calendar PDF path is required"
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Calendar PDF does not exist: ${filePath}`
    );
  }

  if (
    path
      .extname(filePath)
      .toLowerCase() !== ".pdf"
  ) {
    throw new Error(
      "Calendar file must be a PDF"
    );
  }

  const baseName =
    path.basename(filePath);

  if (
    !baseName
      .toLowerCase()
      .includes("calendar")
  ) {
    throw new Error(
      `Calendar upload blocked because the generated filename does not contain "calendar": ${baseName}`
    );
  }
}

async function uploadCalendarPdf({
  filePath,
  orderId,
  itemId,
}) {
  validateCalendarPdf(filePath);

  const safeOrderId =
    sanitizePathPart(orderId);

  const safeItemId =
    sanitizePathPart(itemId);

  if (!safeOrderId) {
    throw new Error(
      "orderId is required"
    );
  }

  if (!safeItemId) {
    throw new Error(
      "itemId is required"
    );
  }

  const folder = [
    "fresh-start-paper",
    "calendars",
    `order-${safeOrderId}`,
    `item-${safeItemId}`,
  ].join("/");

  const publicId =
    `${folder}/calendar`;

  const md5sum =
    await calculateMd5(filePath);

  console.log(
    "===== CALENDAR CLOUDINARY UPLOAD REQUEST ====="
  );

  console.log({
    filePath,
    folder,
    publicId,
    fileType:
      "product",
  });

  const uploadResult =
    await cloudinary.uploader.upload(
      filePath,
      {
        resource_type:
          "raw",
        type:
          "upload",
        public_id:
          publicId,
        format:
          "pdf",
        overwrite:
          true,
        invalidate:
          true,
        use_filename:
          false,
        unique_filename:
          false,
      }
    );

  if (!uploadResult?.secure_url) {
    throw new Error(
      "Cloudinary did not return a calendar URL"
    );
  }

  if (
    !uploadResult.secure_url.includes(
      "/fresh-start-paper/calendars/"
    )
  ) {
    throw new Error(
      `Calendar uploaded to an unexpected Cloudinary path: ${uploadResult.secure_url}`
    );
  }

  return {
    type:
      "product",
    productKind:
      "calendar",
    format:
      "pdf",
    url:
      uploadResult.secure_url,
    secureUrl:
      uploadResult.secure_url,
    md5sum,
    publicId:
      uploadResult.public_id,
    bytes:
      uploadResult.bytes,
    createdAt:
      uploadResult.created_at,
  };
}

module.exports = {
  uploadCalendarPdf,
};