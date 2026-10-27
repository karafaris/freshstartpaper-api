
"use strict";

/*
 * FRESH START PAPER
 * Lulu Sandbox PDF Validation
 *
 * Safe test:
 * - Checks Cloudinary PDF access
 * - Retrieves Lulu cover dimensions
 * - Checks dimensions against existing PDF
 * - Requests interior/cover validation
 * - Does NOT create a print job
 * - Does NOT purchase anything
 */

const {
  luluRequest,
  getLuluPackageId,
} = require("./services/luluService");

const SANDBOX =
  "https://api.sandbox.lulu.com";

const API_URL = String(
  process.env.LULU_API_URL || ""
).replace(/\/+$/, "");

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

function heading(title) {
  console.log("\n========================================");
  console.log(title);
  console.log("========================================");
}

function checkEnvironment() {
  if (API_URL !== SANDBOX) {
    throw new Error(
      "Only Lulu Sandbox is allowed."
    );
  }

  const configured =
    getLuluPackageId("journal");

  if (configured !== SKU) {
    throw new Error(
      `Journal SKU mismatch: ${configured}`
    );
  }

  console.log("Environment: SANDBOX");
  console.log("SKU:", SKU);
  console.log("Interior pages:", PAGE_COUNT);
}

async function checkPdf(url, label) {
  const parsed = new URL(url);

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "res.cloudinary.com"
  ) {
    throw new Error(
      `${label} requires a direct Cloudinary HTTPS URL.`
    );
  }

  console.log(`Checking ${label} PDF...`);

  const response = await fetch(url, {
    headers: {
      Range: "bytes=0-4",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(
      `${label} PDF returned HTTP ${response.status}`
    );
  }

  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);

  try {
    while (bytes.length < 5) {
      const { done, value } =
        await reader.read();

      if (done) break;

      bytes = Buffer.concat([
        bytes,
        Buffer.from(value),
      ]);
    }
  } finally {
    await reader.cancel();
  }

  if (
    bytes.subarray(0, 5)
      .toString("ascii") !== "%PDF-"
  ) {
    throw new Error(
      `${label} did not return valid PDF header data.`
    );
  }

  console.log(`${label}: PDF ACCESSIBLE`);
}

/*
 * IMPORTANT:
 * No "unit" field.
 *
 * Lulu will use its API default.
 */

async function getCoverDimensions() {
  heading("LULU COVER DIMENSIONS");

  const result = await luluRequest(
    "/cover-dimensions/",
    {
      method: "POST",
      body: {
        pod_package_id: SKU,
        interior_page_count: PAGE_COUNT,
      },
    }
  );

  console.log(
    "FULL LULU DIMENSIONS RESPONSE:"
  );

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

/*
 * Compare returned dimensions only when
 * a recognized unit is supplied.
 *
 * Otherwise do not guess the unit.
 */

function checkCoverSize(result) {
  const data =
    result.dimensions || result;

  const width = Number(data.width);
  const height = Number(data.height);

  const unit = String(
    data.unit || ""
  ).toUpperCase();

  const conversion = {
    IN: 72,
    INCH: 72,
    INCHES: 72,
    MM: 72 / 25.4,
    PT: 1,
    POINTS: 1,
  };

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    console.log(
      "Dimensions could not be parsed. " +
      "Review Lulu's full response above."
    );

    return false;
  }

  if (!conversion[unit]) {
    console.log(
      "Lulu returned an unrecognized or missing unit:",
      unit || "(not provided)"
    );

    console.log(
      "Reported dimensions:",
      { width, height }
    );

    return false;
  }

  const expected = {
    width: width * conversion[unit],
    height: height * conversion[unit],
  };

  console.log(
    "Lulu expected dimensions (points):",
    expected
  );

  console.log(
    "Current cover dimensions (points):",
    CURRENT_COVER
  );

  const matches =
    Math.abs(
      expected.width - CURRENT_COVER.width
    ) < 1 &&
    Math.abs(
      expected.height - CURRENT_COVER.height
    ) < 1;

  console.log(
    matches
      ? "COVER DIMENSIONS MATCH"
      : "COVER DIMENSIONS DO NOT MATCH"
  );

  return matches;
}

async function startValidation(
  endpoint,
  payload,
  label
) {
  heading(`${label} VALIDATION`);

  const result = await luluRequest(
    endpoint,
    {
      method: "POST",
      body: payload,
    }
  );

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

async function getValidationStatus(
  endpoint,
  initial,
  label
) {
  const id =
    initial?.id ||
    initial?.validation_id;

  if (!id) {
    console.log(
      `${label}: No validation ID returned.`
    );
    return initial;
  }

  console.log(
    `${label} validation ID: ${id}`
  );

  const result = await luluRequest(
    `${endpoint}${encodeURIComponent(id)}/`
  );

  console.log(
    `${label} status response:`,
    JSON.stringify(result, null, 2)
  );

  return result;
}

function printStatus(label, result) {
  const raw = result?.status;

  const status = String(
    typeof raw === "object"
      ? raw?.name || ""
      : raw || ""
  ).toUpperCase();

  console.log(
    `${label}: ${status || "UNKNOWN"}`
  );

  if (result?.errors?.length) {
    console.log(
      `${label} errors:`,
      JSON.stringify(result.errors, null, 2)
    );
  }

  if (
    ["VALIDATING", "NORMALIZING", "PENDING"]
      .includes(status)
  ) {
    console.log(
      `${label} is still processing.`
    );
  }
}

async function main() {
  heading("FRESH START PAPER — LULU TEST");

  checkEnvironment();

  heading("PDF ACCESSIBILITY");

  await checkPdf(
    INTERIOR_URL,
    "Interior"
  );

  await checkPdf(
    COVER_URL,
    "Cover"
  );

  const dimensions =
    await getCoverDimensions();

  const coverMatches =
    checkCoverSize(dimensions);

  if (!coverMatches) {
    console.log(
      "\nValidation paused: Lulu cover dimensions " +
      "must be confirmed before continuing."
    );

    console.log(
      "No print job or validation job created."
    );

    return;
  }

  const interior =
    await startValidation(
      "/validate-interior/",
      {
        source_url: INTERIOR_URL,
        pod_package_id: SKU,
      },
      "INTERIOR"
    );

  const cover =
    await startValidation(
      "/validate-cover/",
      {
        source_url: COVER_URL,
        pod_package_id: SKU,
        interior_page_count: PAGE_COUNT,
      },
      "COVER"
    );

  const interiorStatus =
    await getValidationStatus(
      "/validate-interior/",
      interior,
      "INTERIOR"
    );

  const coverStatus =
    await getValidationStatus(
      "/validate-cover/",
      cover,
      "COVER"
    );

  heading("FINAL VALIDATION RESULTS");

  printStatus(
    "Interior",
    interiorStatus
  );

  printStatus(
    "Cover",
    coverStatus
  );

  console.log(
    "\nNo Lulu print orders were created."
  );
}

main().catch(error => {
  console.error(
    "\nLULU VALIDATION ERROR:",
    error.message
  );

  process.exitCode = 1;
});
