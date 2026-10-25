"use strict";

/*
|--------------------------------------------------------------------------
| FRESH START PAPER — LULU PRINT API SERVICE
|--------------------------------------------------------------------------
|
| Supports:
| - Lulu Sandbox authentication
| - Lulu Production authentication
| - Current dotted Lulu SKUs
| - Legacy 27-character Lulu SKUs
| - Journal print jobs
| - Notebook print jobs
| - Shopify shipping addresses
| - Cloudinary interior and cover PDF URLs
| - PDF MD5 checksums
| - Print-job status retrieval
|
| Calendars are intentionally blocked until
| their Lulu-compatible PDFs are implemented.
|
| Node.js 18+
|
|--------------------------------------------------------------------------
*/

const SANDBOX_URL =
  "https://api.sandbox.lulu.com";

const PRODUCTION_URL =
  "https://api.lulu.com";

const API_URL = (
  process.env.LULU_API_URL ||
  SANDBOX_URL
).replace(/\/+$/, "");

const TOKEN_PATH =
  "/auth/realms/glasstree/protocol/openid-connect/token";

const TIMEOUT_MS = 30000;

let cachedToken = null;
let tokenExpiresAt = 0;

/*
|--------------------------------------------------------------------------
| ENVIRONMENT HELPERS
|--------------------------------------------------------------------------
*/

function clean(value, fallback = "") {
  const result = String(
    value ?? ""
  ).trim();

  return result || fallback;
}

function env(name) {
  const value = clean(
    process.env[name]
  );

  if (!value) {
    throw new Error(
      `${name} is missing in Render Environment`
    );
  }

  return value;
}

function isSandbox() {
  return API_URL === SANDBOX_URL;
}

/*
|--------------------------------------------------------------------------
| SECURITY / ENVIRONMENT VALIDATION
|--------------------------------------------------------------------------
*/

function validateApiEnvironment() {
  if (
    API_URL !== SANDBOX_URL &&
    API_URL !== PRODUCTION_URL
  ) {
    throw new Error(
      "Invalid LULU_API_URL. " +
      "Use the official Lulu sandbox " +
      "or production API endpoint."
    );
  }
}

function ensureSubmissionEnabled() {
  validateApiEnvironment();

  if (
    process.env.LULU_ENABLED !== "true"
  ) {
    throw new Error(
      "Lulu order submission is disabled. " +
      "LULU_ENABLED must be true."
    );
  }

  if (
    !isSandbox() &&
    process.env.LULU_PRODUCTION_ENABLED !==
      "true"
  ) {
    throw new Error(
      "Production Lulu submissions are disabled. " +
      "LULU_PRODUCTION_ENABLED must be true."
    );
  }
}

/*
|--------------------------------------------------------------------------
| FETCH WITH TIMEOUT
|--------------------------------------------------------------------------
*/

async function fetchWithTimeout(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Lulu API request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/*
|--------------------------------------------------------------------------
| RESPONSE HANDLER
|--------------------------------------------------------------------------
*/

async function parseLuluResponse(response) {
  const raw = await response.text();

  let data;

  try {
    data = raw
      ? JSON.parse(raw)
      : {};
  } catch {
    data = {
      message: raw,
    };
  }

  if (!response.ok) {
    const details =
      JSON.stringify(data);

    throw new Error(
      `Lulu API HTTP ${response.status}: ` +
      details
    );
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| LULU OAUTH AUTHENTICATION
|--------------------------------------------------------------------------
*/

async function getLuluToken() {
  validateApiEnvironment();

  if (
    cachedToken &&
    Date.now() < tokenExpiresAt
  ) {
    return cachedToken;
  }

  const clientKey = env(
    "LULU_CLIENT_KEY"
  );

  const clientSecret = env(
    "LULU_CLIENT_SECRET"
  );

  const credentials = Buffer.from(
    `${clientKey}:${clientSecret}`
  ).toString("base64");

  const response = await fetchWithTimeout(
    `${API_URL}${TOKEN_PATH}`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Basic ${credentials}`,

        "Content-Type":
          "application/x-www-form-urlencoded",

        Accept:
          "application/json",
      },

      body: new URLSearchParams({
        grant_type:
          "client_credentials",
      }),
    }
  );

  const data =
    await parseLuluResponse(response);

  if (!data.access_token) {
    throw new Error(
      "Lulu authentication succeeded " +
      "but no access token was returned."
    );
  }

  cachedToken = data.access_token;

  const expiresIn =
    Number(data.expires_in || 300);

  tokenExpiresAt =
    Date.now() +
    Math.max(
      30,
      expiresIn - 60
    ) * 1000;

  return cachedToken;
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATED LULU REQUEST
|--------------------------------------------------------------------------
*/

async function luluRequest(
  endpoint,
  options = {}
) {
  const accessToken =
    await getLuluToken();

  const method =
    options.method || "GET";

  const headers = {
    Authorization:
      `Bearer ${accessToken}`,

    Accept:
      "application/json",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] =
      "application/json";
  }

  const response = await fetchWithTimeout(
    `${API_URL}${endpoint}`,
    {
      method,
      headers,

      ...(options.body !== undefined
        ? {
            body: JSON.stringify(
              options.body
            ),
          }
        : {}),
    }
  );

  return parseLuluResponse(response);
}

/*
|--------------------------------------------------------------------------
| LULU SKU VALIDATION
|--------------------------------------------------------------------------
|
| Example current Lulu SKU:
|
| 1100X0850.FC.STD.CW.060UW444.MXX
|
| Also supports legacy format:
|
| 1100X0850FCSTDCW060UW444MXX
|
| Keep the dotted SKU exactly as Lulu
| provides it. Do not remove the periods.
|
|--------------------------------------------------------------------------
*/

function validateLuluSku(value) {
  const sku = clean(
    value
  ).toUpperCase();

  const dottedPattern =
    /^[A-Z0-9]{9}\.[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{2}\.[A-Z0-9]{8}\.[A-Z0-9]{3}$/;

  const legacyPattern =
    /^[A-Z0-9]{27}$/;

  if (
    !dottedPattern.test(sku) &&
    !legacyPattern.test(sku)
  ) {
    throw new Error(
      "Invalid Lulu SKU: " +
      sku +
      ". Expected a dotted Lulu SKU " +
      "or legacy 27-character SKU."
    );
  }

  return sku;
}

/*
|--------------------------------------------------------------------------
| PRODUCT PACKAGE RESOLUTION
|--------------------------------------------------------------------------
*/

function getLuluPackageId(productKind) {
  const kind = clean(
    productKind
  ).toLowerCase();

  if (kind === "calendar") {
    throw new Error(
      "Calendar Lulu printing is not ready. " +
      "The existing calendar PDF format " +
      "must be converted first."
    );
  }

  const variables = {
    journal:
      "LULU_JOURNAL_PACKAGE_ID",

    notebook:
      "LULU_NOTEBOOK_PACKAGE_ID",
  };

  const variableName =
    variables[kind];

  if (!variableName) {
    throw new Error(
      `Unsupported Lulu product: ${kind}`
    );
  }

  return validateLuluSku(
    env(variableName)
  );
}

/*
|--------------------------------------------------------------------------
| SHOPIFY SHIPPING ADDRESS
|--------------------------------------------------------------------------
*/

function buildShippingAddress(order) {
  const address =
    order.shipping_address;

  if (!address) {
    throw new Error(
      "Shopify order is missing " +
      "a shipping address."
    );
  }

  const name =
    clean(address.name) ||
    [
      address.first_name,
      address.last_name,
    ]
      .filter(Boolean)
      .join(" ");

  const shipping = {
    name,

    street1:
      clean(address.address1),

    city:
      clean(address.city),

    state_code:
      clean(address.province_code),

    country_code:
      clean(address.country_code),

    postcode:
      clean(address.zip),

    email:
      clean(
        order.email ||
        order.contact_email
      ),

    phone_number:
      clean(
        address.phone ||
        order.phone ||
        process.env.LULU_DEFAULT_PHONE
      ),
  };

  if (address.address2) {
    shipping.street2 =
      clean(address.address2);
  }

  if (address.company) {
    shipping.organization =
      clean(address.company);
  }

  const requiredFields = [
    "name",
    "street1",
    "city",
    "country_code",
    "postcode",
    "email",
    "phone_number",
  ];

  for (const field of requiredFields) {
    if (!shipping[field]) {
      throw new Error(
        `Lulu shipping address missing: ${field}`
      );
    }
  }

  return shipping;
}

/*
|--------------------------------------------------------------------------
| CLOUDINARY PDF NORMALIZATION
|--------------------------------------------------------------------------
*/

function normalizePdfFile(
  file,
  label
) {
  if (!file) {
    throw new Error(
      `Missing ${label} PDF.`
    );
  }

  const source_url =
    clean(
      file.secure_url ||
      file.source_url ||
      file.url
    );

  const source_md5sum =
    clean(
      file.source_md5sum ||
      file.md5sum
    ).toLowerCase();

  if (
    !/^https:\/\//i.test(source_url)
  ) {
    throw new Error(
      `${label} PDF must have an HTTPS URL.`
    );
  }

  if (
    !/^[a-f0-9]{32}$/.test(
      source_md5sum
    )
  ) {
    throw new Error(
      `${label} PDF requires a valid MD5 checksum.`
    );
  }

  return {
    source_url,
    source_md5sum,
  };
}

/*
|--------------------------------------------------------------------------
| BUILD LULU PRINT JOB PAYLOAD
|--------------------------------------------------------------------------
*/

function buildLuluPayload({
  order,
  lineItem,
  uploadedFiles,
  productKind,
}) {
  if (!order?.id) {
    throw new Error(
      "Shopify order ID is required."
    );
  }

  if (!lineItem?.id) {
    throw new Error(
      "Shopify line item ID is required."
    );
  }

  const kind =
    clean(productKind).toLowerCase();

  const pod_package_id =
    getLuluPackageId(kind);

  const quantity =
    Number(lineItem.quantity);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    throw new Error(
      "Invalid Shopify item quantity."
    );
  }

  const interior =
    normalizePdfFile(
      uploadedFiles?.interior ||
      uploadedFiles?.book,
      "Interior"
    );

  const cover =
    normalizePdfFile(
      uploadedFiles?.cover,
      "Cover"
    );

  const externalId =
    `fsp-${order.id}-${lineItem.id}`;

  const title =
    clean(
      lineItem.title,
      `Fresh Start Paper ${kind}`
    );

  return {
    external_id: externalId,

    contact_email:
      env("LULU_CONTACT_EMAIL"),

    shipping_level:
      clean(
        process.env.LULU_SHIPPING_LEVEL,
        "MAIL"
      ),

    shipping_address:
      buildShippingAddress(order),

    line_items: [
      {
        external_id:
          String(lineItem.id),

        title,

        quantity,

        printable_normalization: {
          pod_package_id,
          interior,
          cover,
        },
      },
    ],
  };
}

/*
|--------------------------------------------------------------------------
| SUBMIT LULU PRINT JOB
|--------------------------------------------------------------------------
|
| Does not automatically retry POST requests.
|
| IMPORTANT:
| A persistent fulfillment database/record
| is still required to prevent duplicate
| submissions across restarts or retries.
|
|--------------------------------------------------------------------------
*/

async function submitLuluOrder(args) {
  ensureSubmissionEnabled();

  const payload =
    buildLuluPayload(args);

  console.log(
    "===== LULU SUBMISSION STARTED =====",
    {
      externalId:
        payload.external_id,

      lineItemId:
        payload.line_items[0].external_id,

      packageId:
        payload.line_items[0]
          .printable_normalization
          .pod_package_id,

      quantity:
        payload.line_items[0].quantity,

      environment:
        isSandbox()
          ? "SANDBOX"
          : "PRODUCTION",
    }
  );

  const result = await luluRequest(
    "/print-jobs/",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result?.id) {
    throw new Error(
      "Lulu did not return a print-job ID."
    );
  }

  console.log(
    "===== LULU PRINT JOB CREATED =====",
    {
      jobId: result.id,
      externalId:
        payload.external_id,

      status:
        result.status?.name ||
        result.status ||
        "CREATED",
    }
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| FETCH LULU PRINT JOB
|--------------------------------------------------------------------------
*/

async function getLuluOrder(jobId) {
  if (!jobId) {
    throw new Error(
      "Lulu print-job ID is required."
    );
  }

  return luluRequest(
    `/print-jobs/${encodeURIComponent(jobId)}/`
  );
}

/*
|--------------------------------------------------------------------------
| FETCH LULU PRINT JOB STATUS
|--------------------------------------------------------------------------
*/

async function getLuluOrderStatus(jobId) {
  if (!jobId) {
    throw new Error(
      "Lulu print-job ID is required."
    );
  }

  return luluRequest(
    `/print-jobs/${encodeURIComponent(jobId)}/status/`
  );
}

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
  getLuluToken,
  luluRequest,
  validateLuluSku,
  getLuluPackageId,
  buildShippingAddress,
  normalizePdfFile,
  buildLuluPayload,
  submitLuluOrder,
  getLuluOrder,
  getLuluOrderStatus,
};