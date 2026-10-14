const express = require("express");
const upload = require("../middleware/upload");
const ctrl = require("../controllers/uploadController");
const { protect, requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// Admin-only upload. ?kind=products (default) | categories
router.post(
  "/",
  protect,
  requireAdmin,
  (req, res, next) => {
    const kind = req.query.kind === "categories" ? "categories" : "products";
    req.uploadKind = kind;
    next();
  },
  upload.single("file"),
  ctrl.uploadImage
);

module.exports = router;