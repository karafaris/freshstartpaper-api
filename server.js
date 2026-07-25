require("dotenv").config();

const express = require("express");
const shopifyRoutes = require("./routes/shopify");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Fresh Start Paper API Running");
});

app.use("/shopify", shopifyRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});