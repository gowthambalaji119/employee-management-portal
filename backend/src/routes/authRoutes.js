const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimiter");
const { validateBody } = require("../middleware/validate");

router.post("/login", loginLimiter, validateBody({
  identifier: { required: true, type: "string" },
  password: { required: true, type: "string" },
}), authController.login);

router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.me);

router.post("/session/start", authenticate, authController.startSession);
router.post("/session/resume", authenticate, authController.resumeSession);
router.post("/session/close-previous", authenticate, authController.closePreviousSession);

module.exports = router;
