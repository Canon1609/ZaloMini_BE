const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.post('/register', authController.register);
router.post('/register-app', authController.registerApp);
router.get('/verify-email', authController.verifyEmail);
router.get('/verify-email-app', authController.verifyEmailApp);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/forgot-password-app', authController.forgotPasswordApp);
router.post('/reset-password', authController.resetPassword);


module.exports = router;
