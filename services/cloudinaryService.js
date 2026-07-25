const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function validateCloudinaryConfiguration() {
  const missingVariables = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ].filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Cloudinary environment variables: ${missingVariables.join(", ")}`
    );
  }
}

function sanitizePublicId(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/-+/g, "-");
}

async function uploadPDF({
  filePath,
  orderNumber,
  fileType,
}) {
  validateCloudinaryConfiguration();

  if (!filePath) {
    throw new Error("A PDF file path is required");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file does not exist: ${filePath}`);
  }

  const extension = path.extname(filePath).toLowerCase();

  if (extension !== ".pdf") {
    throw new Error(
      `Only PDF files may be uploaded. Received: ${extension || "no extension"}`
    );
  }

  const safeOrderNumber = sanitizePublicId(
    orderNumber || Date.now()
  );

  const safeFileType = sanitizePublicId(
    fileType || "document"
  );

  const publicId = [
    "fresh-start-paper",
    `order-${safeOrderNumber}`,
    `${safeFileType}.pdf`,
  ].join("/");

  console.log(`Uploading ${fileType} PDF to Cloudinary`);

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
      `Cloudinary did not return a secure URL for ${fileType}`
    );
  }

  return {
    url: result.secure_url,
    secureUrl: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes,
    format: result.format,
    createdAt: result.created_at,
  };
}

async function uploadGeneratedPDFs({
  interiorPath,
  coverPath,
  orderNumber,
}) {
  if (!interiorPath || !coverPath) {
    throw new Error(
      "Both interiorPath and coverPath are required"
    );
  }

  const interior = await uploadPDF({
    filePath: interiorPath,
    orderNumber,
    fileType: "interior",
  });

  const cover = await uploadPDF({
    filePath: coverPath,
    orderNumber,
    fileType: "cover",
  });

  return {
    interior,
    cover,
  };
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
  uploadPDF,
  uploadGeneratedPDFs,
  deleteGeneratedLocalFiles,
};