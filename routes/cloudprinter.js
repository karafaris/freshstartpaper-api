const express = require("express");

const {
  getOrderFiles,
} = require("../services/orderFileStore");

const router = express.Router();

function getBearerToken(req) {
  const authorizationHeader =
    req.get("Authorization") || "";

  if (!authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader
    .slice("Bearer ".length)
    .trim();
}

router.post("/files", async (req, res) => {
  try {
    const receivedToken =
      getBearerToken(req);

    const expectedToken =
      process.env.CLOUDPRINTER_SECURITY_TOKEN;

    if (!expectedToken) {
      console.error(
        "CLOUDPRINTER_SECURITY_TOKEN is not configured"
      );

      return res.status(500).json({
        success: false,
        message:
          "Cloudprinter token is not configured",
      });
    }

    if (
      !receivedToken ||
      receivedToken !== expectedToken
    ) {
      console.error(
        "Unauthorized Cloudprinter request"
      );

      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      orderId,
      itemId,
      fileTypes,
    } = req.body || {};

    if (!orderId || !itemId) {
      return res.status(400).json({
        success: false,
        message:
          "orderId and itemId are required",
      });
    }

    if (
      !Array.isArray(fileTypes) ||
      fileTypes.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "fileTypes must be a non-empty array",
      });
    }

    console.log(
      "Cloudprinter requested files",
      {
        orderId,
        itemId,
        fileTypes,
      }
    );

    const manifest = await getOrderFiles({
      orderId,
      itemId,
    });

    if (!manifest) {
      console.error(
        "No generated files found",
        {
          orderId,
          itemId,
        }
      );

      return res.status(404).json({
        success: false,
        message:
          "Files are not ready for this order item",
      });
    }

    const requestedFiles =
      manifest.files.filter((file) =>
        fileTypes.includes(file.type)
      );

    if (
      requestedFiles.length !==
      fileTypes.length
    ) {
      const availableTypes =
        manifest.files.map(
          (file) => file.type
        );

      return res.status(404).json({
        success: false,
        message:
          "One or more requested files are unavailable",
        requestedTypes: fileTypes,
        availableTypes,
      });
    }

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
      "Cloudprinter file request failed",
      {
        message: error.message,
        stack: error.stack,
      }
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve print files",
    });
  }
});

module.exports = router;