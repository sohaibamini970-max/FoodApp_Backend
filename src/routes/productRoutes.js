const express = require("express");
const ctrl = require("../controllers/productController");

const router = express.Router();
router.get("/", ctrl.listProducts);
router.get("/:id", ctrl.getProduct);

module.exports = router;