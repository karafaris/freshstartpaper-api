const fs = require("fs");

const {
  PDFDocument,
} = require("pdf-lib");

const {
  generateNotebookPDFs,
  NOTEBOOK_TOTAL_PAGES,
  COVER_TOTAL_PAGES,
  PDF_WIDTH_MM,
  PDF_HEIGHT_MM,
} = require("../services/notebookPdfGenerator");

const DIMENSION_TOLERANCE_MM = 0.15;

function pointsToMillimeters(points) {
  return (
    Number(points) *
    25.4 /
    72
  );
}

function assertEqual(
  actual,
  expected,
  message
) {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${expected}, received ${actual}`
    );
  }
}

function assertClose({
  actual,
  expected,
  tolerance,
  message,
}) {
  const difference =
    Math.abs(
      Number(actual) -
      Number(expected)
    );

  if (difference > tolerance) {
    throw new Error(
      [
        message,
        `Expected approximately ${expected}`,
        `Received ${actual}`,
        `Difference ${difference}`,
      ].join(". ")
    );
  }
}

async function inspectPdf({
  filePath,
  expectedPages,
  label,
}) {
  const fileExists =
    fs.existsSync(filePath);

  if (!fileExists) {
    throw new Error(
      `${label} PDF does not exist: ${filePath}`
    );
  }

  const fileBytes =
    await fs.promises.readFile(
      filePath
    );

  if (
    !fileBytes ||
    fileBytes.length === 0
  ) {
    throw new Error(
      `${label} PDF is empty`
    );
  }

  const pdfDocument =
    await PDFDocument.load(
      fileBytes,
      {
        updateMetadata: false,
      }
    );

  const pageCount =
    pdfDocument.getPageCount();

  assertEqual(
    pageCount,
    expectedPages,
    `${label} page count is incorrect`
  );

  const firstPage =
    pdfDocument.getPage(0);

  const {
    width,
    height,
  } = firstPage.getSize();

  const widthMm =
    pointsToMillimeters(
      width
    );

  const heightMm =
    pointsToMillimeters(
      height
    );

  assertClose({
    actual: widthMm,
    expected: PDF_WIDTH_MM,
    tolerance:
      DIMENSION_TOLERANCE_MM,

    message:
      `${label} width is incorrect`,
  });

  assertClose({
    actual: heightMm,
    expected: PDF_HEIGHT_MM,
    tolerance:
      DIMENSION_TOLERANCE_MM,

    message:
      `${label} height is incorrect`,
  });

  return {
    label,
    filePath,
    pageCount,

    widthMm:
      Number(
        widthMm.toFixed(2)
      ),

    heightMm:
      Number(
        heightMm.toFixed(2)
      ),

    fileSizeBytes:
      fileBytes.length,

    fileSizeMb:
      Number(
        (
          fileBytes.length /
          1024 /
          1024
        ).toFixed(2)
      ),
  };
}

async function runTest() {
  console.log(
    "===== NOTEBOOK GENERATOR LOCAL TEST ====="
  );

  /*
   * This order is only test data.
   * It is never sent to Shopify, Cloudinary or Cloudprinter.
   */

  const order = {
    id:
      "notebook-local-test-order",

    order_number:
      "NOTEBOOK-LOCAL-TEST",

    name:
      "#NOTEBOOK-LOCAL-TEST",

    email:
      "test@example.com",
  };

  /*
   * These property names match the Shopify notebook
   * line-item properties.
   */

  const lineItem = {
    id:
      "notebook-test-item",

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

      {
        name:
          "Cover subtitle",

        value:
          "Ideas, strategy and the courage to begin",
      },

      {
        name:
          "Typography style",

        value:
          "Elegant serif",
      },

      {
        name:
          "Cover border style",

        value:
          "Double border",
      },

      {
        name:
          "Cover color",

        value:
          "#6f5948",
      },

      {
        name:
          "Accent or foil color",

        value:
          "#d5b574",
      },

      {
        name:
          "Cover text color",

        value:
          "#fffaf2",
      },

      {
        name:
          "Interior page style",

        value:
          "Lined",
      },

      {
        name:
          "Page header",

        value:
          "Ideas and Action",
      },

      {
        name:
          "Page number style",

        value:
          "Page 1",
      },

      {
        name:
          "Optional page prompt",

        value:
          "What deserves your attention today?",
      },

      {
        name:
          "Interior paper color",

        value:
          "#fffdf8",
      },

      {
        name:
          "Line or grid color",

        value:
          "#d8c8ba",
      },

      {
        name:
          "Page footer phrase",

        value:
          "Trust the idea that will not leave you alone.",
      },
    ],
  };

  const generatedFiles =
    await generateNotebookPDFs(
      order,
      lineItem
    );

  if (
    !generatedFiles
      ?.interiorPath
  ) {
    throw new Error(
      "Generator did not return an interiorPath"
    );
  }

  if (
    !generatedFiles
      ?.coverPath
  ) {
    throw new Error(
      "Generator did not return a coverPath"
    );
  }

  assertEqual(
    generatedFiles.totalPages,
    NOTEBOOK_TOTAL_PAGES,
    "Generator totalPages is incorrect"
  );

  assertEqual(
    generatedFiles.coverPages,
    COVER_TOTAL_PAGES,
    "Generator coverPages is incorrect"
  );

  const interiorResult =
    await inspectPdf({
      filePath:
        generatedFiles
          .interiorPath,

      expectedPages:
        NOTEBOOK_TOTAL_PAGES,

      label:
        "Interior",
    });

  const coverResult =
    await inspectPdf({
      filePath:
        generatedFiles
          .coverPath,

      expectedPages:
        COVER_TOTAL_PAGES,

      label:
        "Cover",
    });

  console.log("");
  console.log(
    "✅ NOTEBOOK GENERATOR TEST PASSED"
  );

  console.log("");
  console.log(
    "Interior PDF:"
  );

  console.log({
    path:
      interiorResult.filePath,

    pages:
      interiorResult.pageCount,

    dimensions:
      `${interiorResult.widthMm} × ${interiorResult.heightMm} mm`,

    fileSize:
      `${interiorResult.fileSizeMb} MB`,
  });

  console.log("");
  console.log(
    "Cover PDF:"
  );

  console.log({
    path:
      coverResult.filePath,

    pages:
      coverResult.pageCount,

    dimensions:
      `${coverResult.widthMm} × ${coverResult.heightMm} mm`,

    fileSize:
      `${coverResult.fileSizeMb} MB`,
  });

  console.log("");
  console.log(
    "No Shopify order, Cloudinary upload or Cloudprinter submission occurred."
  );
}

runTest().catch(
  (error) => {
    console.error("");
    console.error(
      "❌ NOTEBOOK GENERATOR TEST FAILED"
    );

    console.error(
      error.stack ||
      error.message ||
      error
    );

    process.exitCode = 1;
  }
);