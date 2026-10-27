
"use strict";

/*
 * Fresh Start Paper
 * Lulu Sandbox — Cover Validation Only
 *
 * This does not create print orders.
 */

const {
  luluRequest,
} = require("./services/luluService");

const SKU =
  "1100X0850.FC.STD.CW.060UW444.MXX";

const PAGE_COUNT = 366;

// PASTE YOUR NEW DIRECT CLOUDINARY COVER URL HERE
const COVER_URL =
  "PASTE_NEW_DIRECT_CLOUDINARY_COVER_URL_HERE";

async function main() {
  console.log("\nFRESH START PAPER — COVER VALIDATION");

  const apiUrl = String(
    process.env.LULU_API_URL || ""
  ).replace(/\/+$/, "");

  if (apiUrl !== "https://api.sandbox.lulu.com") {
    throw new Error(
      "Sandbox only. Production requests are disabled."
    );
  }

  if (!COVER_URL.startsWith(
    "https://res.cloudinary.com/"
  )) {
    throw new Error(
      "Enter the new direct Cloudinary PDF URL."
    );
  }

  console.log("Checking cover PDF access...");

  const response = await fetch(COVER_URL, {
    method: "GET",
    headers: {
      Range: "bytes=0-4",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Cover PDF returned HTTP ${response.status}`
    );
  }

  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);

  try {
    while (bytes.length < 5) {
      const { done, value } = await reader.read();
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
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error(
      "The URL does not return PDF data."
    );
  }

  console.log("Cover PDF accessible.");

  console.log("Submitting cover validation...");

  const result = await luluRequest(
    "/validate-cover/",
    {
      method: "POST",
      body: {
        source_url: COVER_URL,
        pod_package_id: SKU,
        interior_page_count: PAGE_COUNT,
      },
    }
  );

  console.log(
    "\nLULU RESPONSE:\n",
    JSON.stringify(result, null, 2)
  );

  if (result.id) {
    console.log(
      "\nNEW COVER VALIDATION ID:",
      result.id
    );

    console.log(
      "Use this ID to check validation status."
    );
  }

  console.log(
    "\nNo print order was created."
  );
}

main().catch(error => {
  console.error(
    "\nVALIDATION ERROR:",
    error.message
  );
  process.exitCode = 1;
});
