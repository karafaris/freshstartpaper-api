require("dotenv").config();

const express = require("express");

const shopifyRouter = require("./routes/shopify");

const app = express();
const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| Shopify routes
|--------------------------------------------------------------------------
| This must be mounted before express.json().
| The Shopify route uses express.raw() for HMAC verification.
|--------------------------------------------------------------------------
*/

app.use("/shopify", shopifyRouter);

/*
|--------------------------------------------------------------------------
| Regular JSON parsing
|--------------------------------------------------------------------------
*/

app.use(express.json());

/*
|--------------------------------------------------------------------------
| Home route
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("Fresh Start Paper API Running");
});

/*
|--------------------------------------------------------------------------
| Health-check route
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| Error handler
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});