const express = require("express");
const router = express.Router();
const sessionController = require("../controllers/sessionController");
const { authenticate } = require("../middleware/auth");

router.post("/heartbeat", authenticate, sessionController.heartbeat);
router.get("/current", authenticate, sessionController.currentSessionState);

module.exports = router;
