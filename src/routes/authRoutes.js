const express = require("express");
const { body } = require("express-validator");
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/authController");
const validate = require("../middleware/validate");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many attempts, try again later." },
});

const ALLOWED_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me",
  "aol.com", "zoho.com", "gmx.com", "gmx.net", "mail.com",
  "yandex.com", "fastmail.com", "hey.com",
]);

router.post(
  "/register",
  authLimiter,
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Name too short"),
    body("email")
      .isEmail()
      .withMessage("Please enter a valid email")
      .bail()
      .normalizeEmail()
      .custom((value) => {
        const domain = value.split("@")[1];
        if (!ALLOWED_DOMAINS.has(domain)) {
          throw new Error(
            "Please use a supported email provider (Gmail, Outlook, Yahoo, iCloud, etc.)"
          );
        }
        const local = value.split("@")[0];
        if (/^(test|asdf|qwer|aaa+|123+|fake|abc|xyz)$/i.test(local)) {
          throw new Error("Please use a real email address");
        }
        return true;
      }),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validate,
  ctrl.register
);

router.post(
  "/verify",
  authLimiter,
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("code").isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits"),
  ],
  validate,
  ctrl.verifyCode
);

router.post(
  "/resend-code",
  authLimiter,
  [body("email").isEmail().withMessage("Invalid email")],
  validate,
  ctrl.resendCode
);

router.post(
  "/login",
  authLimiter,
  [
    body("email").isEmail().withMessage("Invalid email").normalizeEmail(),
    body("password").notEmpty().withMessage("Password required"),
  ],
  validate,
  ctrl.login
);

router.post(
  "/forgot-password",
  authLimiter,
  [body("email").isEmail().withMessage("Invalid email")],
  validate,
  ctrl.forgotPassword
);

router.post(
  "/verify-reset-code",
  authLimiter,
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("code").isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits"),
  ],
  validate,
  ctrl.verifyResetCode
);

router.post(
  "/reset-password",
  authLimiter,
  [
    body("reset_token").isLength({ min: 20 }).withMessage("Invalid token"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validate,
  ctrl.resetPassword
);

router.post("/refresh", ctrl.refresh);
router.post("/logout", ctrl.logout);
router.get("/me", protect, ctrl.me);

module.exports = router;