require("dotenv").config();

const express = require("express");

const shopifyRouter =
  require("./routes/shopify");

const cloudprinterRouter =
  require("./routes/cloudprinter");

const downloadsRouter =
  require("./routes/downloads");

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

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

app.use(
  "/cloudprinter",
  cloudprinterRouter
);

app.use(
  "/downloads",
  downloadsRouter
);

/*
|--------------------------------------------------------------------------
| Root
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send(
    "Fresh Start Paper API Running"
  );
});

/*
|--------------------------------------------------------------------------
| Health Check
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
| 404 Handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});