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

function validateCloudinaryConfiguration() {
  const requiredVariables = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];

  const missingVariables = requiredVariables.filter(
    (variableName) => !process.env[variableName]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Cloudinary environment variables: ${missingVariables.join(
        ", "
      )}`
    );
  }
}

function sanitizePublicId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/-+/g, "-");
}

async function calculateFileMd5(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);

  return crypto
    .createHash("md5")
    .update(fileBuffer)
    .digest("hex");
}

async function uploadPDF({
  filePath,
  orderId,
  itemId,
  fileType,
}) {
  validateCloudinaryConfiguration();

  if (!filePath) {
    throw new Error("PDF file path is required");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `PDF file does not exist: ${filePath}`
    );
  }

  const extension = path
    .extname(filePath)
    .toLowerCase();

  if (extension !== ".pdf") {
    throw new Error(
      `Only PDF files may be uploaded. Received: ${
        extension || "no extension"
      }`
    );
  }

  const safeOrderId = sanitizePublicId(orderId);
  const safeItemId = sanitizePublicId(itemId);
  const safeFileType = sanitizePublicId(fileType);

  const publicId = [
    "fresh-start-paper",
    "orders",
    `order-${safeOrderId}`,
    `item-${safeItemId}`,
    `${safeFileType}.pdf`,
  ].join("/");

  const md5sum = await calculateFileMd5(filePath);

  console.log(
    `Uploading ${fileType} PDF to Cloudinary`
  );

  const result = await cloudinary.uploader.upload(
    filePath,
    {
      resource_type: "raw",
      type: "upload",
      public_id: publicId,
      overwrite: true,
      invalidate: true,
      use_filename: false,
      unique_filename: false,
    }
  );

  if (!result.secure_url) {
    throw new Error(
      `Cloudinary did not return a URL for ${fileType}`
    );
  }

  return {
    type: fileType,
    url: result.secure_url,
    secureUrl: result.secure_url,
    md5sum,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes,
    createdAt: result.created_at,
  };
}

async function uploadGeneratedPDFs({
  interiorPath,
  coverPath,
  orderId,
  itemId,
}) {
  if (!interiorPath || !coverPath) {
    throw new Error(
      "Both interiorPath and coverPath are required"
    );
  }

  if (!orderId || !itemId) {
    throw new Error(
      "Both orderId and itemId are required"
    );
  }

  const interior = await uploadPDF({
    filePath: interiorPath,
    orderId,
    itemId,
    fileType: "product",
  });

  const cover = await uploadPDF({
    filePath: coverPath,
    orderId,
    itemId,
    fileType: "cover",
  });

  return {
    interior,
    cover,
  };
}

async function uploadJson({
  data,
  orderId,
  itemId,
}) {
  validateCloudinaryConfiguration();

  const safeOrderId = sanitizePublicId(orderId);
  const safeItemId = sanitizePublicId(itemId);

  const temporaryDirectory = path.join(
    __dirname,
    "..",
    "generated"
  );

  await fs.promises.mkdir(temporaryDirectory, {
    recursive: true,
  });

  const temporaryPath = path.join(
    temporaryDirectory,
    `manifest-${safeOrderId}-${safeItemId}.json`
  );

  await fs.promises.writeFile(
    temporaryPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  const publicId = [
    "fresh-start-paper",
    "manifests",
    `order-${safeOrderId}`,
    `item-${safeItemId}.json`,
  ].join("/");

  try {
    const result =
      await cloudinary.uploader.upload(
        temporaryPath,
        {
          resource_type: "raw",
          type: "upload",
          public_id: publicId,
          overwrite: true,
          invalidate: true,
          use_filename: false,
          unique_filename: false,
        }
      );

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  } finally {
    await deleteLocalFile(temporaryPath);
  }
}

async function deleteLocalFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);

    console.log(
      `Deleted temporary local file: ${filePath}`
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(
        `Unable to delete temporary file ${filePath}:`,
        error.message
      );
    }
  }
}

async function deleteGeneratedLocalFiles({
  interiorPath,
  coverPath,
}) {
  await Promise.all([
    deleteLocalFile(interiorPath),
    deleteLocalFile(coverPath),
  ]);
}

module.exports = {
  uploadGeneratedPDFs,
  uploadJson,
  deleteGeneratedLocalFiles,
};