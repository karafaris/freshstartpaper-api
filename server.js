require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Shopify webhook must use the raw request body for signature verification
app.post(
  "/shopify/order",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const shopifyHmac = req.get("X-Shopify-Hmac-Sha256");
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!shopifyHmac || !secret) {
      console.error("Missing Shopify HMAC or webhook secret");
      return res.status(401).send("Unauthorized");
    }

    const calculatedHmac = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("base64");

    const receivedBuffer = Buffer.from(shopifyHmac, "base64");
    const calculatedBuffer = Buffer.from(calculatedHmac, "base64");

    const isValid =
      receivedBuffer.length === calculatedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, calculatedBuffer);

    if (!isValid) {
      console.error("Invalid Shopify webhook signature");
      return res.status(401).send("Unauthorized");
    }

    const order = JSON.parse(req.body.toString("utf8"));

    console.log("Verified Shopify order received");
console.log("Order ID:", order.id);
console.log("Order number:", order.order_number);

console.log("===== CUSTOMER =====");
console.log({
  email: order.email,
  firstName: order.customer?.first_name,
  lastName: order.customer?.last_name,
});

console.log("===== PRODUCTS =====");

order.line_items?.forEach((item, index) => {
  console.log(`Product ${index + 1}:`, {
    title: item.title,
    variantTitle: item.variant_title,
    productId: item.product_id,
    variantId: item.variant_id,
    quantity: item.quantity,
    sku: item.sku,
    properties: item.properties,
  });
});

    return res.status(200).json({
      success: true,
      message: "Verified order received",
    });
  }
);

// Regular JSON parsing for all other API routes
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Fresh Start Paper API Running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});