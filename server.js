require("dotenv").config();

const express = require("express");
const cors = require("cors");

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
*/

app.use("/shopify", shopifyRouter);

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin: [
      "https://freshstartpaper.com",
      "https://www.freshstartpaper.com",
      "http://localhost:3000"
    ],
    methods: [
      "GET",
      "POST"
    ],
    credentials: false
  })
);

/*
|--------------------------------------------------------------------------
| JSON
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
| Home
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("Fresh Start Paper API Running");
});

/*
|--------------------------------------------------------------------------
| Health
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
| 404
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
| Error Handler
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});