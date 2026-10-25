
"use strict";

/*
 * FRESH START PAPER
 * Lulu Sandbox PDF Validation
 *
 * This script:
 * 1. Checks the two PDF delivery URLs
 * 2. Requests Lulu's expected cover dimensions
 * 3. Starts interior PDF validation
 * 4. Starts cover PDF validation
 * 5. Checks validation statuses
 *
 * DOES NOT create a print job.
 * DOES NOT charge for printing.
 */

const {
  luluRequest,
  getLuluPackageId,
} = require("./services/luluService");

const SKU =
  process.env.LULU_JOURNAL_PACKAGE_ID ||
  "1100X0850.FC.STD.CW.060UW444.MXX";

const PAGE_COUNT = 366;

// Paste DIRECT Cloudinary PDF URLs here.
// Do not use collection.cloudinary.com links.
const INTERIOR_URL =
  process.env.LULU_TEST_INTERIOR_URL ||
  "PASTE_DIRECT_INTERIOR_PDF_URL_HERE";

const COVER_URL =
  process.env.LULU_TEST_COVER_URL ||
  "PASTE_DIRECT_COVER_PDF_URL_HERE";

function checkUrl(url, label) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${label}: enter a valid direct PDF URL`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `${label}: HTTPS is required`
    );
  }

  if (
    parsed.hostname ===
    "collection.cloudinary.com"
  ) {
    throw new Error(
      `${label}: this is a Cloudinary ` +
      "collection-sharing link. " +
      "Use Copy URL > Original."
    );
  }
}

async function checkPdfAccess(url, label) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Range: "bytes=0-4"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `${label}: HTTP ${response.status}. ` +
      "The PDF is not publicly accessible."
    );
  }

  const reader = response.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();

  const prefix = Buffer.from(
    value || []
  ).subarray(0, 5).toString("ascii");

  if (prefix !== "%PDF-") {
    throw new Error(
      `${label}: URL did not return a PDF.`
    );
  }

  console.log(`${label}: PDF accessible`);
}

async function startValidation(
  endpoint,
  payload,
  label
) {
  console.log(`Starting ${label} validation`);

  const result = await luluRequest(
    endpoint,
    {
      method: "POST",
      body: payload
    }
  );

  console.log(
    `${label} initial response:`,
    JSON.stringify(result, null, 2)
  );

  return result;
}

async function checkValidation(
  endpoint,
  id,
  label
) {
  if (id === undefined || id === null) {
    throw new Error(
      `${label}: validation ID missing`
    );
  }

  const result = await luluRequest(
    `${endpoint}${encodeURIComponent(id)}/`
  );

  console.log(
    `${label} status:`,
    result.status
  );

  if (result.errors?.length) {
    console.log(
      `${label} errors:`,
      result.errors
    );
  }

  return result;
}

async function main() {
  if (
    process.env.LULU_API_URL !==
    "https://api.sandbox.lulu.com"
  ) {
    throw new Error(
      "This script only runs against Lulu Sandbox."
    );
  }

  checkUrl(INTERIOR_URL, "Interior");
  checkUrl(COVER_URL, "Cover");

  console.log("Fresh Start Paper Lulu Test");
  console.log("SKU:", SKU);
  console.log("Pages:", PAGE_COUNT);

  await checkPdfAccess(
    INTERIOR_URL,
    "Interior"
  );

  await checkPdfAccess(
    COVER_URL,
    "Cover"
  );

  console.log(
    "Checking Lulu cover dimensions..."
  );

  const dimensions = await luluRequest(
    "/cover-dimensions/",
    {
      method: "POST",
      body: {
        pod_package_id: SKU,
        page_count: PAGE_COUNT,
        unit: "PT"
      }
    }
  );

  console.log(
    "Required Lulu cover dimensions:",
    JSON.stringify(dimensions, null, 2)
  );

  const interior = await startValidation(
    "/validate-interior/",
    {
      source_url: INTERIOR_URL,
      pod_package_id: SKU
    },
    "Interior"
  );

  const cover = await startValidation(
    "/validate-cover/",
    {
      source_url: COVER_URL,
      pod_package_id: SKU,
      page_count: PAGE_COUNT
    },
    "Cover"
  );

  console.log(
    "Validation IDs:",
    {
      interior: interior.id,
      cover: cover.id
    }
  );

  await checkValidation(
    "/validate-interior/",
    interior.id,
    "Interior"
  );

  await checkValidation(
    "/validate-cover/",
    cover.id,
    "Cover"
  );

  console.log(
    "Validation requests completed."
  );

  console.log(
    "If status is VALIDATING or NORMALIZING, " +
    "check the IDs again later. " +
    "Do not interpret those as approval."
  );
}

main().catch(error => {
  console.error(
    "LULU VALIDATION ERROR:",
    error.message
  );

  process.exitCode = 1;
});
