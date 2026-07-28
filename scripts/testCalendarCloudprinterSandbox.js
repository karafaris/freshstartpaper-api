require("dotenv").config();

const fs = require("fs");

const {
  generateCalendarPDFs,
} = require("../services/calendarPdfGenerator");

const {
  uploadCalendarPdf,
} = require("../services/calendarCloudinaryService");

const {
  buildCloudprinterOrderPayload,
  submitCloudprinterOrder,
} = require("../services/cloudprinterService");

const CALENDAR_TOTAL_PAGES = 13;

function requiredEnvironmentVariable(name) {
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

async function deleteLocalFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function run() {
  const confirmation = String(
    process.env
      .CALENDAR_SANDBOX_SUBMIT ||
      ""
  )
    .trim()
    .toUpperCase();

  if (confirmation !== "YES") {
    throw new Error(
      [
        "Sandbox submission is disabled.",
        "Add CALENDAR_SANDBOX_SUBMIT=YES to .env only when you are ready to create one Cloudprinter test order.",
      ].join(" ")
    );
  }

  const timestamp = Date.now();

  const testOrderId =
    `calendar-sandbox-${timestamp}`;

  const testOrderNumber =
    `CAL-SANDBOX-${timestamp}`;

  const testItemId =
    `calendar-item-${timestamp}`;

  let generatedFiles = null;

  try {
    const order = {
      id: testOrderId,

      order_number:
        testOrderNumber,

      name:
        testOrderNumber,

      email:
        requiredEnvironmentVariable(
          "CLOUDPRINTER_TEST_EMAIL"
        ),

      contact_email:
        requiredEnvironmentVariable(
          "CLOUDPRINTER_TEST_EMAIL"
        ),

      financial_status:
        "paid",

      shipping_address: {
        first_name:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_FIRST_NAME"
          ),

        last_name:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_LAST_NAME"
          ),

        company:
          String(
            process.env
              .CLOUDPRINTER_TEST_COMPANY ||
              ""
          ).trim(),

        address1:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_ADDRESS1"
          ),

        address2:
          String(
            process.env
              .CLOUDPRINTER_TEST_ADDRESS2 ||
              ""
          ).trim(),

        city:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_CITY"
          ),

        province:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_STATE"
          ),

        province_code:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_STATE_CODE"
          ),

        zip:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_ZIP"
          ),

        country:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_COUNTRY"
          ),

        country_code:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_COUNTRY_CODE"
          ),

        phone:
          requiredEnvironmentVariable(
            "CLOUDPRINTER_TEST_PHONE"
          ),
      },
    };

    const lineItem = {
      id: testItemId,

      sku: "CUSTOM-CALENDAR",

      title:
        "Fresh Start Paper Calendar Sandbox Test",

      name:
        "Fresh Start Paper Calendar Sandbox Test",

      quantity: 1,

      properties: [
        {
          name: "Calendar year",
          value: "2027",
        },
        {
          name: "Calendar title",
          value: "My Fresh Start",
        },
        {
          name: "Owner name",
          value: "Kara",
        },
        {
          name: "Accent color",
          value: "#B99758",
        },
        {
          name: "Background color",
          value: "#FAF7F0",
        },
        {
          name: "Notes label",
          value: "Goals & Notes",
        },
      ],
    };

    console.log(
      "===== CALENDAR SANDBOX TEST STARTED ====="
    );

    console.log({
      orderId: testOrderId,
      orderNumber: testOrderNumber,
      itemId: testItemId,
      sku: lineItem.sku,
    });

    /*
     * Step 1: Generate the calendar PDF.
     */
    generatedFiles =
      await generateCalendarPDFs(
        order,
        lineItem
      );

    if (!generatedFiles?.productPath) {
      throw new Error(
        "Calendar generator did not return productPath"
      );
    }

    if (
      Number(
        generatedFiles.totalPages
      ) !==
      CALENDAR_TOTAL_PAGES
    ) {
      throw new Error(
        `Expected ${CALENDAR_TOTAL_PAGES} pages but generated ${generatedFiles.totalPages}`
      );
    }

    if (
      !fs.existsSync(
        generatedFiles.productPath
      )
    ) {
      throw new Error(
        `Generated calendar file was not found: ${generatedFiles.productPath}`
      );
    }

    console.log(
      "===== CALENDAR GENERATED ====="
    );

    console.log({
      file:
        generatedFiles.productPath,
      totalPages:
        generatedFiles.totalPages,
      dimensions:
        generatedFiles.dimensions,
    });

    /*
     * Step 2: Upload the exact calendar PDF to Cloudinary.
     */
    const uploadedProduct =
      await uploadCalendarPdf({
        filePath:
          generatedFiles.productPath,
        orderId:
          testOrderId,
        itemId:
          testItemId,
      });

    if (
      !uploadedProduct?.url ||
      !uploadedProduct?.md5sum
    ) {
      throw new Error(
        "Cloudinary did not return a calendar URL and MD5 checksum"
      );
    }

    const uploadedFiles = {
      product:
        uploadedProduct,
    };

    console.log(
      "===== CALENDAR UPLOADED ====="
    );

    console.log({
      type:
        uploadedProduct.type,
      url:
        uploadedProduct.url,
      md5sum:
        uploadedProduct.md5sum,
      bytes:
        uploadedProduct.bytes,
    });

    /*
     * Step 3: Build and inspect the payload before submission.
     */
    const payloadPreview =
      buildCloudprinterOrderPayload({
        order,
        lineItem,
        uploadedFiles,
        totalPages:
          CALENDAR_TOTAL_PAGES,
        productKind:
          "calendar",
      });

    const previewItem =
      payloadPreview.payload.items[0];

    console.log(
      "===== CLOUDPRINTER PAYLOAD PREVIEW ====="
    );

    console.log({
      productKind:
        payloadPreview.productKind,

      product:
        previewItem.product,

      shippingLevel:
        previewItem.shipping_level,

      count:
        previewItem.count,

      fileTypes:
        previewItem.files.map(
          (file) => file.type
        ),

      options:
        previewItem.options.map(
          (option) => option.type
        ),

      deliveryCountry:
        payloadPreview
          .payload
          .addresses[0]
          .country,
    });

    if (
      previewItem.product !==
      "calendar_wall_int_a5_l_double_fc_tnr"
    ) {
      throw new Error(
        `Wrong Cloudprinter product: ${previewItem.product}`
      );
    }

    if (
      previewItem.shipping_level !==
      "cp_ground"
    ) {
      throw new Error(
        `Wrong shipping level: ${previewItem.shipping_level}`
      );
    }

    const fileTypes =
      previewItem.files.map(
        (file) => file.type
      );

    if (
      fileTypes.length !== 1 ||
      fileTypes[0] !== "product"
    ) {
      throw new Error(
        `Calendar payload has incorrect files: ${fileTypes.join(
          ", "
        )}`
      );
    }

    const optionTypes =
      previewItem.options.map(
        (option) => option.type
      );

    if (
      !optionTypes.includes(
        "paper_170mcg"
      )
    ) {
      throw new Error(
        "Calendar payload is missing paper_170mcg"
      );
    }

    if (
      !optionTypes.includes(
        "calendar_13_pages"
      )
    ) {
      throw new Error(
        "Calendar payload is missing calendar_13_pages"
      );
    }

    /*
     * Step 4: Submit one Cloudprinter sandbox order.
     */
    console.log(
      "===== SUBMITTING CLOUDPRINTER SANDBOX ORDER ====="
    );

    const result =
      await submitCloudprinterOrder({
        order,
        lineItem,
        uploadedFiles,
        totalPages:
          CALENDAR_TOTAL_PAGES,
        productKind:
          "calendar",
      });

    if (!result?.success) {
      throw new Error(
        "Cloudprinter did not confirm the sandbox calendar order"
      );
    }

    console.log(
      "===== CALENDAR SANDBOX ORDER ACCEPTED ====="
    );

    console.log({
      productKind:
        result.productKind,
      productReference:
        result.productReference,
      orderReference:
        result.orderReference,
      itemReference:
        result.itemReference,
      status:
        result.status,
      response:
        result.response,
    });

    console.log("");
    console.log(
      "✅ Cloudprinter accepted the calendar sandbox order."
    );

    console.log(
      "Shopify and the live journal webhook were not used."
    );
  } catch (error) {
    console.error("");
    console.error(
      "❌ Calendar Cloudprinter sandbox test failed"
    );

    console.error(
      error?.responseData ||
        error?.message ||
        error
    );

    process.exitCode = 1;
  } finally {
    if (
      generatedFiles?.productPath
    ) {
      try {
        await deleteLocalFile(
          generatedFiles.productPath
        );

        console.log(
          "Local calendar test PDF deleted."
        );
      } catch (cleanupError) {
        console.error(
          "Unable to delete the local calendar test PDF:"
        );

        console.error(
          cleanupError.message
        );
      }
    }
  }
}

run();