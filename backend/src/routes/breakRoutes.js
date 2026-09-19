const express = require("express");
const router = express.Router();
const breakController = require("../controllers/breakController");
const { authenticate } = require("../middleware/auth");
const { requireSelfOrAdmin } = require("../middleware/role");

router.post("/start", authenticate, breakController.startBreak);
router.post("/end", authenticate, breakController.endBreak);
router.get("/history/:userId", authenticate, requireSelfOrAdmin("userId"), breakController.breakHistory);

module.exports = router;
