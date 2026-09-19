const express = require("express");
const router = express.Router();
const leaveController = require("../controllers/leaveController");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

router.post("/", authenticate, leaveController.applyLeave);
router.get("/", authenticate, leaveController.listLeaves); // scoped internally
router.patch("/:id/decision", authenticate, requireRole("admin"), leaveController.decideLeave);

module.exports = router;
