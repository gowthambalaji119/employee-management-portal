const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/attendanceController");
const { authenticate } = require("../middleware/auth");
const { requireRole, requireSelfOrAdmin } = require("../middleware/role");

// Admin-wide stats (must be before the /:userId routes to avoid path collision)
router.get("/admin/overview", authenticate, requireRole("admin"), attendanceController.adminOverview);
router.get("/admin/department-wise", authenticate, requireRole("admin"), attendanceController.departmentWise);
router.get("/admin/daily-trend", authenticate, requireRole("admin"), attendanceController.dailyTrend);

router.get("/:userId/today", authenticate, requireSelfOrAdmin("userId"), attendanceController.todayAttendance);
router.get("/:userId/timeline", authenticate, requireSelfOrAdmin("userId"), attendanceController.timeline);
router.get("/:userId/history", authenticate, requireSelfOrAdmin("userId"), attendanceController.history);
router.get("/:userId/summary", authenticate, requireSelfOrAdmin("userId"), attendanceController.summary);

module.exports = router;
