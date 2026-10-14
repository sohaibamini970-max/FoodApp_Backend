const express = require("express");
const ctrl = require("../controllers/dealController");

const router = express.Router();

router.get("/", ctrl.listDeals);
router.get("/:id", ctrl.getDeal);

module.exports = router;