const axios = require("axios");

const CLOUDPRINTER_BASE_URL =
  "https://api.cloudprinter.com/cloudcore/1.0";

function requireEnvironmentVariable(name) {
  const value = String(
    process.env[name] || ""
  ).trim();

  if (!value) {
    throw new Error(
      `${name} is not configured`
    );
  }

  return value;
}

async function postToCloudprinter(
  endpoint,
  payload
) {
  try {
    const response = await axios.post(
      `${CLOUDPRINTER_BASE_URL}${endpoint}`,
      payload,
      {
        timeout: 30000,
        maxBodyLength: Infinity,
        headers: {
          "Content-Type":
            "application/json",
          Accept: "application/json",
        },
        validateStatus: () => true,
      }
    );

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw new Error(
        [
          `Cloudprinter returned HTTP ${response.status}`,
          JSON.stringify(
            response.data,
            null,
            2
          ),
        ].join("\n")
      );
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        [
          `Cloudprinter request failed with HTTP ${error.response.status}`,
          JSON.stringify(
            error.response.data,
            null,
            2
          ),
        ].join("\n")
      );
    }

    throw error;
  }
}

async function getProductInformation({
  apiKey,
  productReference,
}) {
  return postToCloudprinter(
    "/products/info",
    {
      apikey: apiKey,
      reference: productReference,
    }
  );
}

async function getShippingLevels(apiKey) {
  return postToCloudprinter(
    "/shipping/levels",
    {
      apikey: apiKey,
    }
  );
}

async function main() {
  const apiKey =
    requireEnvironmentVariable(
      "CLOUDPRINTER_API_KEY"
    );

  const productReference =
    requireEnvironmentVariable(
      "CLOUDPRINTER_PRODUCT_REFERENCE"
    );

  console.log(
    "===== CLOUDPRINTER CONNECTION TEST ====="
  );

  console.log({
    productReference,
    apiKeyConfigured: Boolean(apiKey),
  });

  const productInformation =
    await getProductInformation({
      apiKey,
      productReference,
    });

  console.log(
    "\n===== PRODUCT INFORMATION ====="
  );

  console.log(
    JSON.stringify(
      productInformation,
      null,
      2
    )
  );

  const shippingLevels =
    await getShippingLevels(apiKey);

  console.log(
    "\n===== SHIPPING LEVELS ====="
  );

  console.log(
    JSON.stringify(
      shippingLevels,
      null,
      2
    )
  );

  console.log(
    "\n✅ Cloudprinter API test completed"
  );
}

main().catch((error) => {
  console.error(
    "\n❌ Cloudprinter API test failed"
  );

  console.error(error.message);

  process.exitCode = 1;
});