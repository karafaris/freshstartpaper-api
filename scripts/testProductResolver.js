require("dotenv").config();

const { getProductDetection, resolveProduct } = require("../services/productResolver");

const samples = [
  {
    label: "Calendar by SKU",
    lineItem: {
      id: 1,
      sku: "CUSTOM-CALENDAR",
      title: "Personalized Wall Calendar",
      properties: [{ name: "Calendar year", value: "2027" }],
    },
  },
  {
    label: "Calendar by customization field",
    lineItem: {
      id: 2,
      sku: "",
      title: "Fresh Start Personalized Product",
      properties: [{ name: "Calendar title", value: "Our Year" }],
    },
  },
  {
    label: "Journal",
    lineItem: {
      id: 3,
      sku: "CUSTOM-JOURNAL",
      title: "Custom Journal",
      properties: [{ name: "Journal title", value: "My Journal" }],
    },
  },
];

for (const sample of samples) {
  const detection = getProductDetection(sample.lineItem);
  const resolved = resolveProduct(sample.lineItem);
  console.log(`\n${sample.label}`);
  console.log(JSON.stringify({ detection, resolvedKind: resolved.kind }, null, 2));
}
