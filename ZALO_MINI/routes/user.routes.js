const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/profile', protect, userController.getProfile);
router.post('/update-password', protect, userController.updatePassword);
router.put('/update-avatar', protect, upload.single('avatar'), userController.updateAvatar);
router.get('/',protect,userController.getAllUsers);
router.get('/search/:email',protect,userController.searchByEmail);
router.get('/getUserById/:userId',protect,userController.getUserById);
module.exports = router;
