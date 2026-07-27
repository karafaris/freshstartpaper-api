require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  generateCalendarPDFs,
} = require("../services/calendarPdfGenerator");

async function run() {
  try {
    const fakeOrder = {
      id: "local-calendar-test-order",
    };

    const fakeLineItem = {
      id: "local-calendar-test-item",
      sku: "CUSTOM-CALENDAR",
      title: "Calendar",
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

    const result = await generateCalendarPDFs(
      fakeOrder,
      fakeLineItem
    );

    if (!result?.productPath) {
      throw new Error(
        "The calendar generator did not return a productPath."
      );
    }

    if (!fs.existsSync(result.productPath)) {
      throw new Error(
        `The generated calendar PDF was not found at: ${result.productPath}`
      );
    }

    const destinationPath = path.join(
      process.cwd(),
      "calendar-test-output.pdf"
    );

    fs.copyFileSync(
      result.productPath,
      destinationPath
    );

    console.log("Calendar PDF generated successfully.");
    console.log(`Output file: ${destinationPath}`);
    console.log(`Pages: ${result.totalPages}`);
    console.log(
      `Dimensions: ${result.dimensions.widthMm} × ${result.dimensions.heightMm} mm`
    );
    console.log(
      `Bleed: ${result.dimensions.bleedMm} mm`
    );
  } catch (error) {
    console.error("Calendar PDF generation failed:");
    console.error(error);
    process.exitCode = 1;
  }
}

run();