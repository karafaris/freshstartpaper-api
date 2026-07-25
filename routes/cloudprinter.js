const express = require("express");
const crypto = require("crypto");

const {
  getOrderFiles,
} = require("../services/orderFileStore");

const router = express.Router();

function getBearerToken(req) {
  const authorizationHeader =
    req.get("Authorization") || "";

  const match = authorizationHeader.match(
    /^Bearer\s+(.+)$/i
  );

  if (!match) {
    return null;
  }

  return match[1].trim();
}

function securelyCompareTokens(
  receivedToken,
  expectedToken
) {
  if (!receivedToken || !expectedToken) {
    return false;
  }

  const receivedBuffer = Buffer.from(
    String(receivedToken),
    "utf8"
  );

  const expectedBuffer = Buffer.from(
    String(expectedToken),
    "utf8"
  );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

function normalizeFileTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((fileType) =>
          String(fileType || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    ),
  ];
}

function normalizeManifestFiles(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) {
    return [];
  }

  return manifest.files
    .map((file) => ({
      type: String(file?.type || "")
        .trim()
        .toLowerCase(),

      url: String(file?.url || "").trim(),

      md5sum: String(
        file?.md5sum || ""
      ).trim(),
    }))
    .filter(
      (file) =>
        file.type &&
        file.url &&
        file.md5sum
    );
}

router.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "cloudprinter-files",
    status: "available",
  });
});

router.post("/files", async (req, res) => {
  try {
    const expectedToken =
      process.env
        .CLOUDPRINTER_SECURITY_TOKEN;

    if (!expectedToken) {
      console.error(
        "CLOUDPRINTER_SECURITY_TOKEN is not configured"
      );

      return res.status(500).json({
        success: false,
        message:
          "Cloudprinter authentication is not configured",
      });
    }

    const receivedToken =
      getBearerToken(req);

    const authorized =
      securelyCompareTokens(
        receivedToken,
        expectedToken
      );

    if (!authorized) {
      console.error(
        "Unauthorized Cloudprinter request"
      );

      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const body = req.body || {};

    const orderId =
      body.orderId ??
      body.order_id;

    const itemId =
      body.itemId ??
      body.item_id;

    const requestedFileTypes =
      normalizeFileTypes(
        body.fileTypes ??
          body.file_types
      );

    if (
      orderId === undefined ||
      orderId === null ||
      String(orderId).trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    if (
      itemId === undefined ||
      itemId === null ||
      String(itemId).trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "itemId is required",
      });
    }

    if (
      requestedFileTypes.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "fileTypes must be a non-empty array",
      });
    }

    const normalizedOrderId =
      String(orderId).trim();

    const normalizedItemId =
      String(itemId).trim();

    console.log(
      "===== CLOUDPRINTER FILE REQUEST ====="
    );

    console.log({
      orderId: normalizedOrderId,
      itemId: normalizedItemId,
      fileTypes:
        requestedFileTypes,
    });

    const manifest =
      await getOrderFiles({
        orderId:
          normalizedOrderId,
        itemId:
          normalizedItemId,
      });

    if (!manifest) {
      console.error(
        "No generated file manifest found",
        {
          orderId:
            normalizedOrderId,
          itemId:
            normalizedItemId,
        }
      );

      return res.status(404).json({
        success: false,
        message:
          "Files are not ready for this order item",
      });
    }

    const availableFiles =
      normalizeManifestFiles(
        manifest
      );

    if (availableFiles.length === 0) {
      console.error(
        "Manifest does not contain valid files",
        {
          orderId:
            normalizedOrderId,
          itemId:
            normalizedItemId,
          manifest,
        }
      );

      return res.status(500).json({
        success: false,
        message:
          "The stored file manifest is invalid",
      });
    }

    const filesByType = new Map(
      availableFiles.map((file) => [
        file.type,
        file,
      ])
    );

    const missingFileTypes =
      requestedFileTypes.filter(
        (fileType) =>
          !filesByType.has(fileType)
      );

    if (
      missingFileTypes.length > 0
    ) {
      const availableTypes =
        availableFiles.map(
          (file) => file.type
        );

      console.error(
        "Requested file types are unavailable",
        {
          orderId:
            normalizedOrderId,
          itemId:
            normalizedItemId,
          requestedFileTypes,
          missingFileTypes,
          availableTypes,
        }
      );

      return res.status(404).json({
        success: false,
        message:
          "One or more requested files are unavailable",
        requestedTypes:
          requestedFileTypes,
        missingTypes:
          missingFileTypes,
        availableTypes,
      });
    }

    const requestedFiles =
      requestedFileTypes.map(
        (fileType) =>
          filesByType.get(fileType)
      );

    console.log(
      "===== CLOUDPRINTER FILES RETURNED ====="
    );

    console.log({
      orderId: normalizedOrderId,
      itemId: normalizedItemId,
      files: requestedFiles.map(
        (file) => ({
          type: file.type,
          url: file.url,
          md5sum: file.md5sum,
        })
      ),
    });

    return res.status(200).json({
      files: requestedFiles.map(
        (file) => ({
          type: file.type,
          url: file.url,
          md5sum: file.md5sum,
        })
      ),
    });
  } catch (error) {
    console.error(
      "Cloudprinter file request failed"
    );

    console.error({
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve print files",
    });
  }
});

module.exports = router;