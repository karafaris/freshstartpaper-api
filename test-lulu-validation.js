
"use strict";

/*
|--------------------------------------------------------------------------
| FRESH START PAPER — LULU SANDBOX PDF VALIDATION
|--------------------------------------------------------------------------
|
| Product:
| US Letter Landscape Hardcover Journal
|
| SKU:
| 1100X0850.FC.STD.CW.060UW444.MXX
|
| Interior:
| 366 pages
| 810 x 630 PDF points
|
| Cover:
| 1 page
| 1791 x 738 PDF points
|
| This script:
| 1. Checks Cloudinary PDF accessibility
| 2. Requests exact Lulu cover dimensions
| 3. Validates the interior PDF
| 4. Validates the hardcover PDF
| 5. Reports validation IDs and statuses
|
| It DOES NOT:
| - Create print jobs
| - Charge money
| - Submit Shopify orders
| - Enable Lulu fulfillment
|
|--------------------------------------------------------------------------
*/

const {
  luluRequest,
  getLuluPackageId,
} = require("./services/luluService");

/*
|--------------------------------------------------------------------------
| SANDBOX CONFIGURATION
|--------------------------------------------------------------------------
*/

const SANDBOX_URL =
  "https://api.sandbox.lulu.com";

const API_URL = String(
  process.env.LULU_API_URL || ""
).replace(/\/+$/, "");

const SKU =
  "1100X0850.FC.STD.CW.060UW444.MXX";

const INTERIOR_PAGE_COUNT = 366;

/*
|--------------------------------------------------------------------------
| YOUR ACTUAL CLOUDINARY FILES
|--------------------------------------------------------------------------
*/

const INTERIOR_URL =
  "https://res.cloudinary.com/slmfyito/image/upload/v1792962824/lulu-order-999999-item-888888-interior_pon4si.pdf";

const COVER_URL =
  "https://res.cloudinary.com/slmfyito/image/upload/v1792962824/lulu-order-999999-item-888888-cover_zy4ber.pdf";

/*
|--------------------------------------------------------------------------
| SAFETY CHECKS
|--------------------------------------------------------------------------
*/

function validateEnvironment() {
  if (API_URL !== SANDBOX_URL) {
    throw new Error(
      "This test must run against " +
      "https://api.sandbox.lulu.com"
    );
  }

  const configuredSku =
    getLuluPackageId("journal");

  if (configuredSku !== SKU) {
    throw new Error(
      "Your Render Lulu journal SKU " +
      "does not match the test SKU. " +
      `Configured: ${configuredSku}`
    );
  }

  console.log(
    "Environment: LULU SANDBOX"
  );
}

function validateUrl(url, label) {
  const parsed = new URL(url);

  if (parsed.protocol !== "https:") {
    throw new Error(
      `${label} must use HTTPS.`
    );
  }

  if (
    parsed.hostname !==
    "res.cloudinary.com"
  ) {
    throw new Error(
      `${label} must use the direct ` +
      "Cloudinary delivery URL."
    );
  }
}

/*
|--------------------------------------------------------------------------
| CHECK PDF ACCESSIBILITY
|--------------------------------------------------------------------------
*/

async function checkPdfAccess(
  url,
  label
) {
  validateUrl(url, label);

  console.log(
    `Checking ${label} PDF...`
  );

  const response = await fetch(
    url,
    {
      method: "GET",
      headers: {
        Range: "bytes=0-4",
      },
      signal:
        AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(
      `${label} Cloudinary HTTP ` +
      response.status
    );
  }

  const reader =
    response.body.getReader();

  let prefix = Buffer.alloc(0);

  try {
    while (prefix.length < 5) {
      const { done, value } =
        await reader.read();

      if (done) break;

      prefix = Buffer.concat([
        prefix,
        Buffer.from(value),
      ]);
    }
  } finally {
    await reader.cancel();
  }

  if (
    prefix.subarray(0, 5)
      .toString("ascii") !== "%PDF-"
  ) {
    throw new Error(
      `${label} URL did not return PDF data.`
    );
  }

  console.log(
    `${label}: PDF ACCESSIBLE`
  );
}

/*
|--------------------------------------------------------------------------
| GET LULU COVER DIMENSIONS
|--------------------------------------------------------------------------
*/

async function calculateCoverDimensions() {
  console.log(
    "\n===== COVER DIMENSION CHECK ====="
  );

  const payload = {
    pod_package_id: SKU,

    interior_page_count:
      INTERIOR_PAGE_COUNT,

    unit: "in",
  };

  const result = await luluRequest(
    "/cover-dimensions/",
    {
      method: "POST",
      body: payload,
    }
  );

  console.log(
    "Lulu cover dimensions:",
    JSON.stringify(result, null, 2)
  );

  const width =
    Number(result.width);

  const height =
    Number(result.height);

  if (
    Number.isFinite(width) &&
    Number.isFinite(height)
  ) {
    console.log(
      "Expected PDF dimensions in points:"
    );

    console.log({
      width: width * 72,
      height: height * 72,
    });

    console.log(
      "Current cover PDF: 1791 x 738 points"
    );

    const widthMatches =
      Math.abs(width * 72 - 1791) < 1;

    const heightMatches =
      Math.abs(height * 72 - 738) < 1;

    if (!widthMatches || !heightMatches) {
      console.warn(
        "WARNING: Your cover PDF dimensions " +
        "do not match Lulu's calculated dimensions."
      );
    } else {
      console.log(
        "Cover dimensions match Lulu."
      );
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| START INTERIOR VALIDATION
|--------------------------------------------------------------------------
*/

async function validateInterior() {
  console.log(
    "\n===== INTERIOR VALIDATION ====="
  );

  const result = await luluRequest(
    "/validate-interior/",
    {
      method: "POST",

      body: {
        source_url:
          INTERIOR_URL,

        pod_package_id:
          SKU,
      },
    }
  );

  console.log(
    "Interior response:",
    JSON.stringify(result, null, 2)
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| START COVER VALIDATION
|--------------------------------------------------------------------------
*/

async function validateCover() {
  console.log(
    "\n===== COVER VALIDATION ====="
  );

  const result = await luluRequest(
    "/validate-cover/",
    {
      method: "POST",

      body: {
        source_url:
          COVER_URL,

        pod_package_id:
          SKU,

        interior_page_count:
          INTERIOR_PAGE_COUNT,
      },
    }
  );

  console.log(
    "Cover response:",
    JSON.stringify(result, null, 2)
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| CHECK VALIDATION STATUS
|--------------------------------------------------------------------------
*/

async function checkValidationStatus(
  type,
  validationId
) {
  if (
    validationId === undefined ||
    validationId === null
  ) {
    console.warn(
      `${type}: No validation ID returned.`
    );

    return null;
  }

  const endpoint =
    type === "interior"
      ? "/validate-interior/"
      : "/validate-cover/";

  const result = await luluRequest(
    `${endpoint}${encodeURIComponent(
      validationId
    )}/`
  );

  console.log(
    `\n${type.toUpperCase()} STATUS:`,
    JSON.stringify(result, null, 2)
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| REPORT VALIDATION RESULT
|--------------------------------------------------------------------------
*/

function explainStatus(
  label,
  result
) {
  if (!result) return;

  const status = String(
    result.status || ""
  ).toUpperCase();

  console.log(
    `${label} validation status: ${status}`
  );

  if (
    status === "NORMALIZED" ||
    status === "VALIDATED"
  ) {
    console.log(
      `${label}: Validation succeeded.`
    );
  } else if (
    status === "VALIDATING" ||
    status === "NORMALIZING"
  ) {
    console.log(
      `${label}: Processing is still underway.`
    );
  } else if (status === "ERROR") {
    console.error(
      `${label}: Lulu reported errors:`,
      JSON.stringify(
        result.errors || [],
        null,
        2
      )
    );
  } else {
    console.log(
      `${label}: Review Lulu response.`
    );
  }
}

/*
|--------------------------------------------------------------------------
| MAIN TEST
|--------------------------------------------------------------------------
*/

async function main() {
  console.log(
    "\n=================================="
  );

  console.log(
    "FRESH START PAPER — LULU TEST"
  );

  console.log(
    "=================================="
  );

  validateEnvironment();

  console.log("SKU:", SKU);

  console.log(
    "Interior pages:",
    INTERIOR_PAGE_COUNT
  );

  /*
   * Step 1: Verify PDF URLs.
   */

  await checkPdfAccess(
    INTERIOR_URL,
    "Interior"
  );

  await checkPdfAccess(
    COVER_URL,
    "Cover"
  );

  /*
   * Step 2: Calculate Lulu cover dimensions.
   */

  await calculateCoverDimensions();

  /*
   * Step 3: Request interior validation.
   */

  const interior =
    await validateInterior();

  /*
   * Step 4: Request cover validation.
   */

  const cover =
    await validateCover();

  /*
   * Step 5: Retrieve initial statuses.
   */

  const interiorId = interior?.id;
  const coverId = cover?.id;

  console.log(
    "\n===== VALIDATION IDS ====="
  );

  console.log({
    interiorId,
    coverId,
  });

  const interiorStatus =
    await checkValidationStatus(
      "interior",
      interiorId
    );

  const coverStatus =
    await checkValidationStatus(
      "cover",
      coverId
    );

  /*
   * Step 6: Print summary.
   */

  console.log(
    "\n===== VALIDATION SUMMARY ====="
  );

  explainStatus(
    "INTERIOR",
    interiorStatus || interior
  );

  explainStatus(
    "COVER",
    coverStatus || cover
  );

  console.log(
    "\nNo print jobs were created."
  );

  console.log(
    "LULU_ENABLED remains unchanged."
  );
}

main().catch(error => {
  console.error(
    "\nLULU VALIDATION ERROR:",
    error.message
  );

  process.exitCode = 1;
});
