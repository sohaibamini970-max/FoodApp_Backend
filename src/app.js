const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const authRoutes = require("./routes/authRoutes");
const oauthRoutes = require("./routes/oauthRoutes");
const adminRoutes = require("./routes/adminRoutes");
const errorHandler = require("./middleware/errorHandler");

// ✅ 1. CREATE app FIRST
const app = express();

// ✅ 2. THEN add middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// ── Request logger (helpful for debugging upload) ──
app.use((req, res, next) => {
  console.log("\n🔵 [REQ]", req.method, req.url);
  console.log("   Content-Type:", req.headers["content-type"] || "(none)");
  console.log("   Content-Length:", req.headers["content-length"] || "?");
  next();
});

// ── JSON parser — SKIP multipart ──
app.use((req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return next();
  }
  express.json({ limit: "10mb" })(req, res, next);
});

// ── Static uploads ──
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    maxAge: "30d",
    immutable: true,
  })
);

// ── Health ──
app.get("/health", (req, res) => res.json({ ok: true }));

// ── Routes ──
app.use("/api/admin/upload", require("./routes/uploadRoutes"));
app.use("/api/admin", adminRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));

app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/deals", require("./routes/dealRoutes"));

app.use("/api/contact", require("./routes/contactRoutes"));

// ── 404 + errors ──
app.use((req, res) => res.status(404).json({ message: "Route not found" }));
app.use(errorHandler);

module.exports = app;