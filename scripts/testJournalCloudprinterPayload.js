require("dotenv").config();

const {
  buildCloudprinterOrderPayload,
} = require("../services/cloudprinterService");

function run() {
  try {
    const fakeOrder = {
      id: "journal-regression-order",
      order_number: "JOURNAL-REGRESSION-TEST",
      name: "#JOURNAL-REGRESSION-TEST",
      email:
        process.env.CLOUDPRINTER_SUPPORT_EMAIL ||
        "test@example.com",

      shipping_address: {
        first_name: "Kara",
        last_name: "Test",
        company: "Fresh Start Paper",
        address1: "123 Test Street",
        address2: "",
        city: "Kansas City",
        province: "Missouri",
        province_code: "MO",
        zip: "64101",
        country: "United States",
        country_code: "US",
        phone:
          process.env.CLOUDPRINTER_SUPPORT_PHONE ||
          "8165550100",
      },
    };

    const fakeLineItem = {
      id: "journal-regression-item",
      sku: "CUSTOM-JOURNAL",
      title: "Custom Journal",
      name: "Custom Journal",
      quantity: 1,
    };

    const fakeMd5 =
      "0123456789abcdef0123456789abcdef";

    const uploadedFiles = {
      interior: {
        type: "product",
        url:
          "https://example.com/journal-interior.pdf",
        md5sum: fakeMd5,
      },

      cover: {
        type: "cover",
        url:
          "https://example.com/journal-cover.pdf",
        md5sum: fakeMd5,
      },
    };

    const result =
      buildCloudprinterOrderPayload({
        order: fakeOrder,
        lineItem: fakeLineItem,
        uploadedFiles,
        totalPages: 366,
        productKind: "journal",
      });

    const item =
      result.payload.items[0];

    const fileTypes =
      item.files.map(
        (file) => file.type
      );

    const optionTypes =
      item.options.map(
        (option) => option.type
      );

    console.log(
      "===== JOURNAL PAYLOAD REGRESSION TEST ====="
    );

    console.log({
      productKind:
        result.productKind,

      product:
        item.product,

      shippingLevel:
        item.shipping_level,

      count:
        item.count,

      fileTypes,

      options:
        item.options,

      totalPages:
        result.totalPages,
    });

    if (
      result.productKind !==
      "journal"
    ) {
      throw new Error(
        `Expected journal but received ${result.productKind}`
      );
    }

    if (
      result.totalPages !==
      366
    ) {
      throw new Error(
        `Expected 366 pages but received ${result.totalPages}`
      );
    }

    if (
      fileTypes.length !== 2
    ) {
      throw new Error(
        `Expected two journal files but received ${fileTypes.length}`
      );
    }

    if (
      !fileTypes.includes("book")
    ) {
      throw new Error(
        "Journal payload is missing the book file"
      );
    }

    if (
      !fileTypes.includes("cover")
    ) {
      throw new Error(
        "Journal payload is missing the cover file"
      );
    }

    if (
      !optionTypes.includes(
        "total_pages"
      )
    ) {
      throw new Error(
        "Journal payload is missing total_pages"
      );
    }

    if (
      optionTypes.includes(
        "calendar_13_pages"
      )
    ) {
      throw new Error(
        "Calendar options appeared in the journal payload"
      );
    }

    if (
      optionTypes.includes(
        "paper_170mcg"
      )
    ) {
      throw new Error(
        "Calendar paper appeared in the journal payload"
      );
    }

    console.log("");
    console.log(
      "✅ Journal Cloudprinter payload is still correct"
    );

    console.log(
      "No Cloudprinter order was submitted."
    );
  } catch (error) {
    console.error("");
    console.error(
      "❌ Journal payload regression test failed"
    );

    console.error(error);

    process.exitCode = 1;
  }
}

run();