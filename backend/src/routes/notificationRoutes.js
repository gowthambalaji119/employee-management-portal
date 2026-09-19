const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, notificationController.listNotifications);
router.patch("/:id/read", authenticate, notificationController.markRead);
router.patch("/read-all", authenticate, notificationController.markAllRead);

module.exports = router;
