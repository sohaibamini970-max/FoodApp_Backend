const express = require("express");
const ctrl = require("../controllers/categoryController");

const router = express.Router();
router.get("/", ctrl.listCategories);

module.exports = router;