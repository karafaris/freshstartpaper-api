
"use strict";

/*
 * FRESH START PAPER
 * Lulu Sandbox Journal PDF Validation
 *
 * No print jobs created.
 * No Shopify orders submitted.
 * No Lulu purchases made.
 */

const {
  luluRequest,
  getLuluPackageId,
} = require("./services/luluService");

const API_URL = String(
  process.env.LULU_API_URL || ""
).replace(/\/+$/, "");

const SANDBOX_URL =
  "https://api.sandbox.lulu.com";

const SKU =
  "1100X0850.FC.STD.CW.060UW444.MXX";

const PAGE_COUNT = 366;

const INTERIOR_URL =
  "https://res.cloudinary.com/slmfyito/image/upload/v1792962824/lulu-order-999999-item-888888-interior_pon4si.pdf";

const COVER_URL =
  "https://res.cloudinary.com/slmfyito/image/upload/v1792962824/lulu-order-999999-item-888888-cover_zy4ber.pdf";

const CURRENT_COVER = {
  width: 1791,
  height: 738,
};

function heading(value) {
  console.log(
    "\n========================================"
  );
  console.log(value);
  console.log(
    "========================================"
  );
}

function verifyEnvironment() {
  if (API_URL !== SANDBOX_URL) {
    throw new Error(
      "Validation must use Lulu Sandbox."
    );
  }

  const configuredSKU =
    getLuluPackageId("journal");

  if (configuredSKU !== SKU) {
    throw new Error(
      `SKU mismatch: ${configuredSKU}`
    );
  }

  console.log("Environment: SANDBOX");
  console.log("SKU:", SKU);
  console.log("Page count:", PAGE_COUNT);
}

async function checkPDF(url, label) {
  const parsed = new URL(url);

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "res.cloudinary.com"
  ) {
    throw new Error(
      `${label} must be a direct Cloudinary HTTPS URL.`
    );
  }

  console.log(`Checking ${label}...`);

  const response = await fetch(url, {
    headers: {
      Range: "bytes=0-4",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(
      `${label}: HTTP ${response.status}`
    );
  }

  const reader = response.body.getReader();
  let received = Buffer.alloc(0);

  try {
    while (received.length < 5) {
      const { done, value } =
        await reader.read();

      if (done) break;

      received = Buffer.concat([
        received,
        Buffer.from(value),
      ]);
    }
  } finally {
    await reader.cancel();
  }

  if (
    received.subarray(0, 5)
      .toString("ascii") !== "%PDF-"
  ) {
    throw new Error(
      `${label} did not return PDF data.`
    );
  }

  console.log(`${label}: PDF ACCESSIBLE`);
}

async function checkCoverDimensions() {
  heading("LULU COVER DIMENSIONS");

  const result = await luluRequest(
    "/cover-dimensions/",
    {
      method: "POST",
      body: {
        pod_package_id: SKU,
        interior_page_count: PAGE_COUNT,
        unit: "IN",
      },
    }
  );

  console.log(
    "Lulu response:",
    JSON.stringify(result, null, 2)
  );

  const dimensions =
    result.dimensions || result;

  const width = Number(dimensions.width);
  const height = Number(dimensions.height);

  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    const unit = String(
      dimensions.unit || "IN"
    ).toUpperCase();

    const multiplier = {
      IN: 72,
      MM: 72 / 25.4,
      PT: 1,
    }[unit];

    if (!multiplier) {
      console.log(
        "Unrecognized dimension unit:",
        unit
      );
      return result;
    }

    const expectedWidth = width * multiplier;
    const expectedHeight = height * multiplier;

    console.log(
      "Expected cover size in PDF points:",
      {
        width: expectedWidth,
        height: expectedHeight,
      }
    );

    console.log(
      "Current cover:",
      CURRENT_COVER
    );

    const matches =
      Math.abs(
        expectedWidth - CURRENT_COVER.width
      ) < 1 &&
      Math.abs(
        expectedHeight - CURRENT_COVER.height
      ) < 1;

    if (matches) {
      console.log(
        "COVER DIMENSIONS MATCH"
      );
    } else {
      console.warn(
        "COVER DIMENSION MISMATCH"
      );
      console.warn(
        "The PDF generator may require changes."
      );
    }
  } else {
    console.log(
      "Review the Lulu response for exact dimensions."
    );
  }

  return result;
}

async function beginValidation(
  endpoint,
  body,
  label
) {
  heading(`${label} VALIDATION`);

  const result = await luluRequest(
    endpoint,
    {
      method: "POST",
      body,
    }
  );

  console.log(
    `${label} response:`,
    JSON.stringify(result, null, 2)
  );

  return result;
}

async function readValidationStatus(
  endpoint,
  response,
  label
) {
  const id =
    response?.id ||
    response?.validation_id;

  if (!id) {
    console.log(
      `${label}: No validation ID was returned.`
    );

    return response;
  }

  console.log(
    `${label} validation ID: ${id}`
  );

  const result = await luluRequest(
    `${endpoint}${encodeURIComponent(id)}/`
  );

  console.log(
    `${label} latest response:`,
    JSON.stringify(result, null, 2)
  );

  return result;
}

function summarize(label, result) {
  const rawStatus = result?.status;

  const status = String(
    typeof rawStatus === "object"
      ? rawStatus?.name || ""
      : rawStatus || ""
  ).toUpperCase();

  console.log(`${label}: ${status || "UNKNOWN"}`);

  if (result?.errors?.length) {
    console.log(
      `${label} errors:`,
      JSON.stringify(result.errors, null, 2)
    );
  }

  if (
    status === "NORMALIZING" ||
    status === "VALIDATING" ||
    status === "PENDING"
  ) {
    console.log(
      `${label} is still processing.`
    );
  }

  if (
    status === "NORMALIZED" ||
    status === "VALIDATED"
  ) {
    console.log(
      `${label} passed the reported stage.`
    );
  }
}

async function main() {
  heading("FRESH START PAPER — LULU TEST");

  verifyEnvironment();

  heading("PDF ACCESSIBILITY");

  await checkPDF(INTERIOR_URL, "Interior");
  await checkPDF(COVER_URL, "Cover");

  const dimensions =
    await checkCoverDimensions();

  const interior =
    await beginValidation(
      "/validate-interior/",
      {
        source_url: INTERIOR_URL,
        pod_package_id: SKU,
      },
      "INTERIOR"
    );

  const cover =
    await beginValidation(
      "/validate-cover/",
      {
        source_url: COVER_URL,
        pod_package_id: SKU,
        interior_page_count: PAGE_COUNT,
      },
      "COVER"
    );

  const interiorStatus =
    await readValidationStatus(
      "/validate-interior/",
      interior,
      "INTERIOR"
    );

  const coverStatus =
    await readValidationStatus(
      "/validate-cover/",
      cover,
      "COVER"
    );

  heading("RESULT SUMMARY");

  summarize(
    "Interior",
    interiorStatus
  );

  summarize(
    "Cover",
    coverStatus
  );

  console.log(
    "\nNo print jobs were created."
  );

  console.log(
    "Cover dimensions response:",
    JSON.stringify(dimensions)
  );
}

main().catch(error => {
  console.error(
    "\nLULU VALIDATION ERROR:",
    error.message
  );

  process.exitCode = 1;
});
