require("dotenv").config();

/*
|--------------------------------------------------------------------------
| Safe test-only fallbacks
|--------------------------------------------------------------------------
|
| This script only builds and inspects the JSON payload.
| It does not call submitCloudprinterOrder() and does not contact
| Cloudprinter.
|
*/

process.env.CLOUDPRINTER_API_KEY ||=
  "payload-test-api-key";

process.env.CLOUDPRINTER_SUPPORT_EMAIL ||=
  "support@example.com";

process.env.CLOUDPRINTER_SUPPORT_PHONE ||=
  "+18165550100";

const {
  buildCloudprinterOrderPayload,
} = require("../services/cloudprinterService");

const {
  resolveProduct,
  NOTEBOOK_TOTAL_PAGES,
} = require("../services/productResolver");

function assertEqual(
  actual,
  expected,
  message
) {
  if (actual !== expected) {
    throw new Error(
      [
        message,
        `Expected: ${JSON.stringify(expected)}`,
        `Received: ${JSON.stringify(actual)}`,
      ].join("\n")
    );
  }
}

function assertDeepEqual(
  actual,
  expected,
  message
) {
  assertEqual(
    JSON.stringify(actual),
    JSON.stringify(expected),
    message
  );
}

function findOption(options, type) {
  return options.find(
    (option) => option.type === type
  );
}

function runTest() {
  console.log(
    "===== NOTEBOOK CLOUDPRINTER PAYLOAD TEST ====="
  );

  const order = {
    id: "notebook-payload-test-order",

    order_number:
      "NOTEBOOK-PAYLOAD-TEST",

    name:
      "#NOTEBOOK-PAYLOAD-TEST",

    email:
      "customer@example.com",

    contact_email:
      "customer@example.com",

    phone:
      "+18165550101",

    customer: {
      first_name: "Test",
      last_name: "Customer",
      email:
        "customer@example.com",
      phone:
        "+18165550101",
    },

    shipping_address: {
      first_name: "Test",
      last_name: "Customer",
      company:
        "Fresh Start Paper Test",

      address1:
        "123 Main Street",

      address2:
        "Suite 100",

      city:
        "Kansas City",

      province:
        "Missouri",

      province_code:
        "MO",

      country:
        "United States",

      country_code:
        "US",

      zip:
        "64108",

      phone:
        "+18165550101",
    },
  };

  const lineItem = {
    id:
      "notebook-payload-test-item",

    product_id:
      "notebook-test-product",

    variant_id:
      "notebook-test-variant",

    title:
      "Custom A3 Landscape Notebook",

    name:
      "Custom A3 Landscape Notebook",

    sku:
      "textbook_co_a3_l_fc_ink",

    variant_title:
      "A3 Landscape Coil Binding",

    quantity: 1,

    properties: [
      {
        name:
          "_Customization version",

        value:
          "Fresh Start Paper Notebook Customizer v1",
      },

      {
        name:
          "Notebook title",

        value:
          "Build Something Brilliant",
      },

      {
        name:
          "Owner name or initials",

        value:
          "KarBear",
      },
    ],
  };

  /*
   * These are fake HTTPS file records.
   * They are only used to verify payload formatting.
   */

  const uploadedFiles = {
    interior: {
      type: "interior",

      url:
        "https://example.com/notebook-book.pdf",

      md5sum:
        "11111111111111111111111111111111",
    },

    cover: {
      type: "cover",

      url:
        "https://example.com/notebook-cover.pdf",

      md5sum:
        "22222222222222222222222222222222",
    },
  };

  const productConfiguration =
    resolveProduct(lineItem);

  assertEqual(
    productConfiguration.kind,
    "notebook",
    "The resolver did not identify the notebook"
  );

  assertEqual(
    productConfiguration.productReference,
    "textbook_co_a3_l_fc_ink",
    "The notebook product reference is incorrect"
  );

  assertEqual(
    productConfiguration.totalPages,
    NOTEBOOK_TOTAL_PAGES,
    "The notebook page count is incorrect"
  );

  const {
    payload,
    orderReference,
    itemReference,
    totalPages,
  } =
    buildCloudprinterOrderPayload({
      order,
      lineItem,
      uploadedFiles,

      totalPages:
        NOTEBOOK_TOTAL_PAGES,

      productConfiguration,
    });

  if (
    !payload ||
    !Array.isArray(payload.items) ||
    payload.items.length !== 1
  ) {
    throw new Error(
      "The Cloudprinter payload does not contain exactly one item"
    );
  }

  const item =
    payload.items[0];

  assertEqual(
    item.product,
    "textbook_co_a3_l_fc_ink",
    "Cloudprinter payload product is incorrect"
  );

  assertEqual(
    item.count,
    "1",
    "Cloudprinter quantity is incorrect"
  );

  assertEqual(
    item.shipping_level,
    productConfiguration.shippingLevel,
    "Cloudprinter shipping level is incorrect"
  );

  assertEqual(
    totalPages,
    NOTEBOOK_TOTAL_PAGES,
    "Returned notebook totalPages is incorrect"
  );

  assertDeepEqual(
    item.files,
    [
      {
        type: "book",

        url:
          uploadedFiles.interior.url,

        md5sum:
          uploadedFiles.interior.md5sum,
      },

      {
        type: "cover",

        url:
          uploadedFiles.cover.url,

        md5sum:
          uploadedFiles.cover.md5sum,
      },
    ],

    "Notebook Cloudprinter file mapping is incorrect"
  );

  const totalPagesOption =
    findOption(
      item.options,
      "total_pages"
    );

  if (!totalPagesOption) {
    throw new Error(
      "The Cloudprinter payload is missing the total_pages option"
    );
  }

  assertEqual(
    totalPagesOption.count,
    String(
      NOTEBOOK_TOTAL_PAGES
    ),

    "The Cloudprinter total_pages count is incorrect"
  );

  const expectedOptions =
    productConfiguration.options.map(
      (option) => ({
        type:
          String(option.type),

        count:
          String(
            option.count
          ),
      })
    );

  assertDeepEqual(
    item.options,
    expectedOptions,
    "Cloudprinter notebook options do not match the product resolver"
  );

  assertEqual(
    payload.addresses[0].country,
    "US",
    "Delivery country is incorrect"
  );

  assertEqual(
    payload.addresses[0].state,
    "MO",
    "Delivery state is incorrect"
  );

  /*
   * Hide the API key before printing the payload.
   */

  const safePayload =
    JSON.parse(
      JSON.stringify(
        payload
      )
    );

  safePayload.apikey =
    "[hidden]";

  console.log("");
  console.log(
    "✅ NOTEBOOK CLOUDPRINTER PAYLOAD TEST PASSED"
  );

  console.log("");
  console.log({
    orderReference,
    itemReference,

    productKind:
      productConfiguration.kind,

    product:
      item.product,

    totalPages,

    shippingLevel:
      item.shipping_level,

    fileTypes:
      item.files.map(
        (file) =>
          file.type
      ),

    options:
      item.options,
  });

  console.log("");
  console.log(
    "Safe payload preview:"
  );

  console.log(
    JSON.stringify(
      safePayload,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "No Cloudinary upload or Cloudprinter order submission occurred."
  );
}

try {
  runTest();
} catch (error) {
  console.error("");

  console.error(
    "❌ NOTEBOOK CLOUDPRINTER PAYLOAD TEST FAILED"
  );

  console.error(
    error.stack ||
      error.message ||
      error
  );

  process.exitCode = 1;
}