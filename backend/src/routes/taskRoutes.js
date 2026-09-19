const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

router.post("/", authenticate, requireRole("admin"), taskController.createTask);
router.get("/", authenticate, taskController.listTasks); // scoped internally to self unless admin
router.patch("/:id/status", authenticate, taskController.updateTaskStatus);

module.exports = router;
