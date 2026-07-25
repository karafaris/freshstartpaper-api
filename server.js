require("dotenv").config();

const express = require("express");

const shopifyRouter =
  require("./routes/shopify");

const cloudprinterRouter =
  require("./routes/cloudprinter");

const app = express();
const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| Shopify webhook
|--------------------------------------------------------------------------
| Must appear before express.json() because it requires the raw body.
|--------------------------------------------------------------------------
*/

app.use("/shopify", shopifyRouter);

/*
|--------------------------------------------------------------------------
| Standard JSON routes
|--------------------------------------------------------------------------
*/

app.use(express.json());

app.use(
  "/cloudprinter",
  cloudprinterRouter
);

app.get("/", (req, res) => {
  res.send(
    "Fresh Start Paper API Running"
  );
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use((error, req, res, next) => {
  console.error(
    "Unhandled server error:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});