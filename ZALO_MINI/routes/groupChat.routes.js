// Trong routes/groupChat.routes.js
const express = require('express');
const router = express.Router();
const groupChatController = require('../controllers/groupChat.controller');
const { protect } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.post('/', protect, upload.single('file'), groupChatController.sendMessageToGroup);
router.get('/:groupId', protect, groupChatController.getMessagesByGroupId);
router.delete('/', protect, groupChatController.deleteGroupMessage);
router.post('/recall', protect, groupChatController.recallGroupMessage);
router.post('/forward', protect, groupChatController.forwardGroupMessage); 

module.exports = router;