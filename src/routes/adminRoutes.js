const express = require("express");
const ctrl = require("../controllers/adminController");
const catCtrl = require("../controllers/categoryController");
const prodCtrl = require("../controllers/productController");
const { protect, requireAdmin } = require("../middleware/authMiddleware");
const dealCtrl = require("../controllers/dealController");

const router = express.Router();
router.use(protect, requireAdmin);

// users
router.get("/users", ctrl.listUsers);
router.post("/users", ctrl.createUser);
router.patch("/users/:id", ctrl.updateUser);
router.delete("/users/:id", ctrl.deleteUser);

// categories
router.post("/categories", catCtrl.createCategory);
router.patch("/categories/:id", catCtrl.updateCategory);
router.delete("/categories/:id", catCtrl.deleteCategory);

// products
router.post("/products", prodCtrl.createProduct);
router.patch("/products/:id", prodCtrl.updateProduct);
router.delete("/products/:id", prodCtrl.deleteProduct);
router.patch("/products/:id/toggle", prodCtrl.toggleAvailable);

// deals
router.get("/deals", dealCtrl.adminListDeals);
router.post("/deals", dealCtrl.createDeal);
router.patch("/deals/:id", dealCtrl.updateDeal);
router.patch("/deals/:id/toggle", dealCtrl.toggleDeal);
router.delete("/deals/:id", dealCtrl.deleteDeal);

const contactCtrl = require("../controllers/contactController");

router.get("/contact", contactCtrl.adminListMessages);
router.patch("/contact/:id", contactCtrl.updateMessageStatus);
router.delete("/contact/:id", contactCtrl.deleteMessage);

const orderCtrl = require("../controllers/orderController");

router.get("/orders", orderCtrl.adminListOrders);
router.patch("/orders/:id/status", orderCtrl.updateOrderStatus);
router.patch("/orders/:id/payment", orderCtrl.updatePaymentStatus);

module.exports = router;