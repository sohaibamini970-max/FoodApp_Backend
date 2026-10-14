const express = require("express");
const ctrl = require("../controllers/oauthController");

const router = express.Router();

router.get("/google", ctrl.googleRedirect);
router.get("/google/callback", ctrl.googleCallback);

router.get("/facebook", ctrl.facebookRedirect);
router.get("/facebook/callback", ctrl.facebookCallback);

module.exports = router;