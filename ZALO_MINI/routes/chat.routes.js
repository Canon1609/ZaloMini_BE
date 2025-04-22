const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
// phương thức GET để lấy danh sách cuộc trò chuyện theo userId
router.get('/:userId' ,protect, chatController.getListConversationByUserId);
// phương thức POST để tạo tin nhắn mới , upload file lên S3 nếu có
router.post('/',protect, upload.single('file'), chatController.createMessage);
// phương thức GET để lấy danh sách tin nhắn giữa hai người dùng theo conversationId
router.get('/messages/:userId', protect, chatController.getMessagesByConversationId);
router.post('/mark-read/', protect, chatController.markMessagesAsRead);

router.delete('/delete', protect, messageController.deleteMessage);
router.post('/recall', protect, messageController.recallMessage);
router.post('/forward', protect, messageController.forwardMessage);
module.exports = router;
