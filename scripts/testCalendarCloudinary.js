require("dotenv").config();

const fs = require("fs");

const {
  generateCalendarPDFs,
} = require("../services/calendarPdfGenerator");

const {
  uploadCalendarPdf,
} = require("../services/calendarCloudinaryService");

async function run() {
  const timestamp = Date.now();

  const testOrderId =
    `calendar-cloudinary-test-${timestamp}`;

  const testItemId = "custom-calendar";

  try {
    const fakeOrder = {
      id: testOrderId,
      name: `CALENDAR-TEST-${timestamp}`,
    };

    const fakeLineItem = {
      id: testItemId,
      sku: "CUSTOM-CALENDAR",
      title: "Calendar",
      name: "Calendar",
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
      "Generating isolated calendar test PDF..."
    );

    const generated = await generateCalendarPDFs(
      fakeOrder,
      fakeLineItem
    );

    if (!generated?.productPath) {
      throw new Error(
        "Calendar generator did not return productPath"
      );
    }

    if (!fs.existsSync(generated.productPath)) {
      throw new Error(
        `Generated calendar PDF was not found: ${generated.productPath}`
      );
    }

    console.log("Calendar generated successfully.");
    console.log(`File: ${generated.productPath}`);
    console.log(`Pages: ${generated.totalPages}`);

    if (generated.dimensions) {
      console.log(
        `Dimensions: ${generated.dimensions.widthMm} × ${generated.dimensions.heightMm} mm`
      );

      console.log(
        `Bleed: ${generated.dimensions.bleedMm} mm`
      );
    }

    if (generated.totalPages !== 13) {
      throw new Error(
        `Expected 13 calendar pages, but received ${generated.totalPages}`
      );
    }

    const uploaded = await uploadCalendarPdf({
      filePath: generated.productPath,
      orderId: testOrderId,
      itemId: testItemId,
    });

    console.log("");
    console.log(
      "Calendar Cloudinary upload succeeded."
    );

    console.log(
      JSON.stringify(
        {
          type: uploaded.type,
          format: uploaded.format,
          url: uploaded.url,
          md5sum: uploaded.md5sum,
          publicId: uploaded.publicId,
          bytes: uploaded.bytes,
        },
        null,
        2
      )
    );

    console.log("");
    console.log(
      "No Shopify order or Cloudprinter order was created."
    );
  } catch (error) {
    console.error("");
    console.error(
      "Calendar Cloudinary test failed:"
    );
    console.error(error);
    process.exitCode = 1;
  }
}

run();