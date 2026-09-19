const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");
const { authenticate } = require("../middleware/auth");
const { requireRole, requireSelfOrAdmin } = require("../middleware/role");

router.get("/attendance", authenticate, requireRole("admin"), reportController.attendanceReport);
router.get("/daily", authenticate, requireRole("admin"), reportController.dailyReport);
router.get("/weekly", authenticate, requireRole("admin"), reportController.weeklyReport);
router.get("/monthly", authenticate, requireRole("admin"), reportController.monthlyReport);
router.get("/breaks", authenticate, requireRole("admin"), reportController.breakReport);
router.get("/overtime", authenticate, requireRole("admin"), reportController.overtimeReport);
router.get("/leaves", authenticate, requireRole("admin"), reportController.leaveReport);
router.get("/work-hours/:userId", authenticate, requireSelfOrAdmin("userId"), reportController.employeeWorkHoursReport);

module.exports = router;
