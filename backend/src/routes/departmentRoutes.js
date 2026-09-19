const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

router.get("/", authenticate, departmentController.listDepartments);
router.post("/", authenticate, requireRole("admin"), departmentController.createDepartment);
router.put("/:id", authenticate, requireRole("admin"), departmentController.updateDepartment);
router.delete("/:id", authenticate, requireRole("admin"), departmentController.deleteDepartment);

module.exports = router;
