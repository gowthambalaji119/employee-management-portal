const express = require("express");
const router = express.Router();
const employeeController = require("../controllers/employeeController");
const { authenticate } = require("../middleware/auth");
const { requireRole, requireSelfOrAdmin } = require("../middleware/role");

// Admin-only listing & management
router.get("/", authenticate, requireRole("admin"), employeeController.listEmployees);
router.get("/online", authenticate, requireRole("admin"), employeeController.listOnlineStatus);
router.post("/", authenticate, requireRole("admin"), employeeController.createEmployee);
router.put("/:id", authenticate, requireRole("admin"), employeeController.updateEmployee);
router.patch("/:id/deactivate", authenticate, requireRole("admin"), employeeController.deactivateEmployee);
router.patch("/:id/activate", authenticate, requireRole("admin"), employeeController.activateEmployee);

// Self or admin
router.get("/:id", authenticate, requireSelfOrAdmin("id"), employeeController.getEmployee);
router.put("/:userId/profile", authenticate, requireSelfOrAdmin("userId"), employeeController.updateOwnProfile);

module.exports = router;
