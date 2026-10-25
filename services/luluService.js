
"use strict";

// services/luluService.js
// Fresh Start Paper / Lulu Print API
// Requires Node.js 18 or newer.

const API_URL = (
  process.env.LULU_API_URL ||
  "https://api.sandbox.lulu.com"
).replace(/\/+$/, "");

let token = null;
let expiresAt = 0;

function env(name) {
  const value = String(
    process.env[name] || ""
  ).trim();

  if (!value) {
    throw new Error(
      `${name} is missing in Render Environment`
    );
  }

  return value;
}

async function responseJson(response) {
  const raw = await response.text();
  let parsed;

  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }

  if (!response.ok) {
    throw new Error(
      `Lulu API ${response.status}: ` +
      JSON.stringify(parsed)
    );
  }

  return parsed;
}

async function getLuluToken() {
  if (token && Date.now() < expiresAt) {
    return token;
  }

  const basic = Buffer.from(
    `${env("LULU_CLIENT_KEY")}:${env("LULU_CLIENT_SECRET")}`
  ).toString("base64");

  const response = await fetch(
    `${API_URL}/auth/realms/glasstree/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials"
      })
    }
  );

  const result = await responseJson(response);

  if (!result.access_token) {
    throw new Error(
      "Lulu did not return an access token"
    );
  }

  token = result.access_token;

  expiresAt =
    Date.now() +
    Math.max(
      30,
      Number(result.expires_in || 300) - 60
    ) * 1000;

  return token;
}

async function luluRequest(
  path,
  { method = "GET", body } = {}
) {
  const accessToken = await getLuluToken();

  const response = await fetch(
    `${API_URL}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) })
    }
  );

  return responseJson(response);
}

function shippingAddress(order) {
  const a = order.shipping_address;

  if (!a) {
    throw new Error(
      "Shopify order is missing shipping_address"
    );
  }

  const address = {
    name:
      a.name ||
      [a.first_name, a.last_name]
        .filter(Boolean)
        .join(" "),

    street1: a.address1,
    city: a.city,
    state_code: a.province_code,
    country_code: a.country_code,
    postcode: a.zip,

    email:
      order.email ||
      order.contact_email,

    phone_number:
      a.phone ||
      order.phone ||
      process.env.LULU_DEFAULT_PHONE ||
      undefined
  };

  if (a.address2) {
    address.street2 = a.address2;
  }

  if (a.company) {
    address.organization = a.company;
  }

  for (const key of [
    "name",
    "street1",
    "city",
    "country_code",
    "postcode",
    "phone_number"
  ]) {
    if (!address[key]) {
      throw new Error(
        `Lulu shipping address missing ${key}`
      );
    }
  }

  return address;
}

function normalizeFile(file, label) {
  const source_url =
    file?.secure_url ||
    file?.source_url ||
    file?.url;

  const source_md5sum =
    file?.source_md5sum ||
    file?.md5sum;

  if (
    !source_url ||
    !/^https:\/\//i.test(source_url)
  ) {
    throw new Error(
      `Missing HTTPS ${label} PDF URL`
    );
  }

  if (
    !/^[a-f0-9]{32}$/i.test(
      source_md5sum || ""
    )
  ) {
    throw new Error(
      `Missing MD5 for ${label} PDF`
    );
  }

  return {
    source_url,
    source_md5sum
  };
}

function buildLuluPayload({
  order,
  lineItem,
  uploadedFiles,
  productKind
}) {
  if (!order?.id || !lineItem?.id) {
    throw new Error(
      "Missing Shopify order or line item ID"
    );
  }

  if (
    !["journal", "notebook"].includes(
      productKind
    )
  ) {
    throw new Error(
      `Lulu submission blocked for ${productKind}; ` +
      "print format not yet compatible"
    );
  }

  const quantity = Number(
    lineItem.quantity
  );

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    throw new Error(
      "Invalid quantity"
    );
  }

  const packageVar =
    productKind === "journal"
      ? "LULU_JOURNAL_PACKAGE_ID"
      : "LULU_NOTEBOOK_PACKAGE_ID";

  const pod_package_id = env(packageVar);

  if (
    !/^[A-Z0-9]{27}$/.test(
      pod_package_id
    )
  ) {
    throw new Error(
      `Invalid ${packageVar}: ` +
      "expected 27-character Lulu SKU"
    );
  }

  return {
    external_id:
      `fsp-${order.id}-${lineItem.id}`,

    contact_email:
      env("LULU_CONTACT_EMAIL"),

    shipping_level:
      process.env.LULU_SHIPPING_LEVEL ||
      "MAIL",

    shipping_address:
      shippingAddress(order),

    line_items: [
      {
        external_id:
          String(lineItem.id),

        title:
          String(
            lineItem.title ||
            `Fresh Start Paper ${productKind}`
          ),

        quantity,

        printable_normalization: {
          pod_package_id,

          interior: normalizeFile(
            uploadedFiles?.interior ||
            uploadedFiles?.book,
            "interior"
          ),

          cover: normalizeFile(
            uploadedFiles?.cover,
            "cover"
          )
        }
      }
    ]
  };
}

async function submitLuluOrder(args) {
  if (
    process.env.LULU_ENABLED !== "true"
  ) {
    throw new Error(
      "Lulu submission disabled; " +
      "set LULU_ENABLED=true after testing"
    );
  }

  if (
    API_URL !==
      "https://api.sandbox.lulu.com" &&
    process.env.LULU_PRODUCTION_ENABLED !==
      "true"
  ) {
    throw new Error(
      "Production Lulu submission requires " +
      "LULU_PRODUCTION_ENABLED=true"
    );
  }

  const payload = buildLuluPayload(args);

  // Do not automatically retry the POST.
  // Lulu may have already accepted the job.
  return luluRequest(
    "/print-jobs/",
    {
      method: "POST",
      body: payload
    }
  );
}

async function getLuluOrder(id) {
  return luluRequest(
    `/print-jobs/${encodeURIComponent(id)}/`
  );
}

async function getLuluOrderStatus(id) {
  return luluRequest(
    `/print-jobs/${encodeURIComponent(id)}/status/`
  );
}

module.exports = {
  getLuluToken,
  luluRequest,
  buildLuluPayload,
  submitLuluOrder,
  getLuluOrder,
  getLuluOrderStatus
};
