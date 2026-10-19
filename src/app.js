const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const authRoutes = require("./routes/authRoutes");
const oauthRoutes = require("./routes/oauthRoutes");
const adminRoutes = require("./routes/adminRoutes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: "https://food-app-internee1.vercel.app", credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-cart-session"], }));

app.use((req, res, next) => {
  console.log("\n🔵 [REQ]", req.method, req.url);
  next();
});

app.use((req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) return next();
  express.json({ limit: "10mb" })(req, res, next);
});

app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    maxAge: "30d",
    immutable: true,
  })
);

// Standard route mounting (no double-mounting needed)
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/deals", require("./routes/dealRoutes"));
app.use("/api/contact", require("./routes/contactRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ message: "Route not found" }));
app.use(errorHandler);

module.exports = app;
