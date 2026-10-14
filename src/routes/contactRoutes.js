const express = require("express");
const { body } = require("express-validator");
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/contactController");
const validate = require("../middleware/validate");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Strict rate limit: 5 messages per 15 min per IP
const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { message: "Too many messages. Please try again later." },
});

// Optional auth — attach req.user if logged in
const tryAuth = (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return next();
    return protect(req, res, next);
};

router.post(
    "/",
    contactLimiter,
    tryAuth,
    [
        body("name").trim().isLength({ min: 2 }).withMessage("Name too short"),
        body("email").isEmail().withMessage("Invalid email").normalizeEmail(),
        body("subject").trim().isLength({ min: 3 }).withMessage("Subject too short"),
        body("message")
            .trim()
            .isLength({ min: 10, max: 5000 })
            .withMessage("Message must be 10-5000 characters"),
    ],
    validate,
    ctrl.createMessage
);

module.exports = router;