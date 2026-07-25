const express = require("express");

const router = express.Router();

router.post("/order", (req, res) => {
  console.log("✅ Shopify order received");
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).json({
    success: true,
    message: "Order received",
  });
});

module.exports = router;