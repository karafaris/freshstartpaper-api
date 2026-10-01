require("dotenv").config();

const {
  resolveProduct,
  JOURNAL_TOTAL_PAGES,
  CALENDAR_TOTAL_PAGES,
  NOTEBOOK_TOTAL_PAGES,
} = require("../services/productResolver");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(
        expected
      )}, received ${JSON.stringify(actual)}`
    );
  }
}

function assertRequiredFiles(
  configuration,
  expectedFiles,
  label
) {
  const actualFiles = Array.isArray(
    configuration.requiredFiles
  )
    ? configuration.requiredFiles.map((file) => ({
        sourceKey: file.sourceKey,
        cloudprinterType: file.cloudprinterType,
      }))
    : [];

  assertEqual(
    JSON.stringify(actualFiles),
    JSON.stringify(expectedFiles),
    `${label} requiredFiles are incorrect`
  );
}

function runCase({
  label,
  lineItem,
  expected,
}) {
  const configuration =
    resolveProduct(lineItem);

  assertEqual(
    configuration.kind,
    expected.kind,
    `${label} product kind is incorrect`
  );

  assertEqual(
    configuration.productReference,
    expected.productReference,
    `${label} product reference is incorrect`
  );

  assertEqual(
    configuration.totalPages,
    expected.totalPages,
    `${label} total page count is incorrect`
  );

  assertRequiredFiles(
    configuration,
    expected.requiredFiles,
    label
  );

  console.log(`✅ ${label} passed`);

  console.log({
    kind: configuration.kind,

    productReference:
      configuration.productReference,

    totalPages:
      configuration.totalPages,

    requiredFiles:
      configuration.requiredFiles,
  });

  console.log("");
}

function runTests() {
  console.log(
    "===== PRODUCT RESOLVER TEST ====="
  );

  console.log("");

  /*
  |--------------------------------------------------------------------------
  | Notebook
  |--------------------------------------------------------------------------
  */

  runCase({
    label: "Notebook",

    lineItem: {
      id: "notebook-test-item",

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
      ],
    },

    expected: {
      kind: "notebook",

      productReference:
        process.env
          .CLOUDPRINTER_NOTEBOOK_PRODUCT_REFERENCE ||
        "textbook_co_a3_l_fc_ink",

      totalPages:
        NOTEBOOK_TOTAL_PAGES,

      requiredFiles: [
        {
          sourceKey: "interior",

          cloudprinterType:
            "book",
        },

        {
          sourceKey: "cover",

          cloudprinterType:
            "cover",
        },
      ],
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Calendar
  |--------------------------------------------------------------------------
  */

  runCase({
    label: "Calendar",

    lineItem: {
      id: "calendar-test-item",

      title:
        "Custom Wall Calendar",

      name:
        "Custom Wall Calendar",

      sku:
        "calendar_wall_int_a5_l_double_fc_tnr",

      variant_title:
        "A5 Landscape",

      quantity: 1,

      properties: [
        {
          name:
            "_Customization version",

          value:
            "Fresh Start Paper Calendar Customizer v1",
        },

        {
          name:
            "Calendar title",

          value:
            "Our Year",
        },
      ],
    },

    expected: {
      kind: "calendar",

      productReference:
        process.env
          .CLOUDPRINTER_CALENDAR_PRODUCT_REFERENCE ||
        "calendar_wall_int_a5_l_double_fc_tnr",

      totalPages:
        CALENDAR_TOTAL_PAGES,

      requiredFiles: [
        {
          sourceKey:
            "product",

          cloudprinterType:
            "product",
        },
      ],
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Journal
  |--------------------------------------------------------------------------
  */

  runCase({
    label: "Journal",

    lineItem: {
      id: "journal-test-item",

      title:
        "Custom Journal",

      name:
        "Custom Journal",

      sku:
        "textbook_pb_1025x6630_l_fc_ink",

      variant_title:
        "Default Title",

      quantity: 1,

      properties: [
        {
          name:
            "Journal title",

          value:
            "Ritual Magic",
        },
      ],
    },

    expected: {
      kind: "journal",

      productReference:
        process.env
          .CLOUDPRINTER_JOURNAL_PRODUCT_REFERENCE ||
        process.env
          .CLOUDPRINTER_PRODUCT_REFERENCE ||
        "textbook_pb_1025x6630_l_fc_ink",

      totalPages:
        JOURNAL_TOTAL_PAGES,

      requiredFiles: [
        {
          sourceKey:
            "interior",

          cloudprinterType:
            "book",
        },

        {
          sourceKey:
            "cover",

          cloudprinterType:
            "cover",
        },
      ],
    },
  });

  console.log(
    "✅ ALL PRODUCT RESOLVER TESTS PASSED"
  );
}

try {
  runTests();
} catch (error) {
  console.error("");

  console.error(
    "❌ PRODUCT RESOLVER TEST FAILED"
  );

  console.error(
    error.stack ||
      error.message ||
      error
  );

  process.exitCode = 1;
}