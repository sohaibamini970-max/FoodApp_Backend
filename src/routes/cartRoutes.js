const express = require("express");
const ctrl = require("../controllers/cartController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Optional auth — cart works for guests (session) and users (JWT)
// Try to attach req.user if token present, but don't fail if absent
const tryAuth = (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return next();
    return protect(req, res, next);
};

router.get("/", tryAuth, ctrl.getCart);
router.post("/items", tryAuth, ctrl.addItem);
router.patch("/items/:id", tryAuth, ctrl.updateItem);
router.delete("/items/:id", tryAuth, ctrl.removeItem);
router.delete("/", tryAuth, ctrl.clearCart);
router.post("/merge", protect, ctrl.mergeGuestCart);

module.exports = router;