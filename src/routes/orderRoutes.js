const express = require("express");
const ctrl = require("../controllers/orderController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Optional auth — supports guests
const tryAuth = (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return next();
    return protect(req, res, next);
};

router.post("/checkout", tryAuth, ctrl.checkout);
router.get("/track/:token", ctrl.trackOrder);
router.get("/my", protect, ctrl.myOrders);
router.get("/session/:sid", ctrl.sessionOrders);
router.patch("/:token/cancel", tryAuth, ctrl.cancelOwnOrder);

module.exports = router;