require("dotenv").config();

const {
  buildCloudprinterOrderPayload,
} = require("../services/cloudprinterService");

function run() {
  try {
    const fakeOrder = {
      id: "calendar-payload-test-order",
      order_number: "CALENDAR-PAYLOAD-TEST",
      email:
        process.env.CLOUDPRINTER_SUPPORT_EMAIL ||
        "test@example.com",
      shipping_address: {
        first_name: "Kara",
        last_name: "Test",
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
      id: "custom-calendar-item",
      sku: "CUSTOM-CALENDAR",
      title: "Calendar",
      quantity: 1,
    };

    const fakeMd5 =
      "0123456789abcdef0123456789abcdef";

    const uploadedFiles = {
      product: {
        type: "product",
        url:
          "https://example.com/calendar-product.pdf",
        md5sum: fakeMd5,
      },
    };

    const result =
      buildCloudprinterOrderPayload({
        order: fakeOrder,
        lineItem:
          fakeLineItem,
        uploadedFiles,
        totalPages: 13,
        productKind:
          "calendar",
      });

    const item =
      result.payload.items[0];

    console.log(
      "===== CALENDAR PAYLOAD TEST ====="
    );

    console.log({
      productKind:
        result.productKind,
      product:
        item.product,
      shippingLevel:
        item.shipping_level,
      files:
        item.files,
      options:
        item.options,
      count:
        item.count,
    });

    const expectedProduct =
      "calendar_wall_int_a5_l_double_fc_tnr";

    const fileTypes =
      item.files.map(
        (file) =>
          file.type
      );

    const optionTypes =
      item.options.map(
        (option) =>
          option.type
      );

    if (
      item.product !==
      expectedProduct
    ) {
      throw new Error(
        `Wrong calendar product: ${item.product}`
      );
    }

    if (
      item.shipping_level !==
      "cp_ground"
    ) {
      throw new Error(
        `Wrong shipping level: ${item.shipping_level}`
      );
    }

    if (
      fileTypes.length !==
        1 ||
      fileTypes[0] !==
        "product"
    ) {
      throw new Error(
        `Wrong calendar files: ${fileTypes.join(
          ", "
        )}`
      );
    }

    if (
      !optionTypes.includes(
        "paper_170mcg"
      )
    ) {
      throw new Error(
        "Calendar paper option is missing"
      );
    }

    if (
      !optionTypes.includes(
        "calendar_13_pages"
      )
    ) {
      throw new Error(
        "Calendar page option is missing"
      );
    }

    if (
      optionTypes.includes(
        "total_pages"
      )
    ) {
      throw new Error(
        "Journal total_pages option must not appear in a calendar payload"
      );
    }

    console.log("");
    console.log(
      "✅ Calendar Cloudprinter payload is correct"
    );

    console.log(
      "No Cloudprinter order was submitted."
    );
  } catch (error) {
    console.error(
      "❌ Calendar payload test failed"
    );

    console.error(
      error
    );

    process.exitCode = 1;
  }
}

run();