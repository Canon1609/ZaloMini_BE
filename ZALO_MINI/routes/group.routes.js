const express = require('express');
const router = express.Router();
const groupController = require('../controllers/group.controller');
const { protect } = require('../middleware/auth.middleware'); // Sử dụng middleware bảo vệ đăng nhập

router.post('/', protect, groupController.createGroup);
router.get('/my-groups', protect, groupController.getUserGroups);
router.post('/:groupId/members', protect, groupController.addMember);
router.delete('/:groupId/members/:userIdToRemove', protect, groupController.removeMember);
router.delete('/:groupId', protect, groupController.disbandGroup);
router.put('/:groupId/admins/:userIdToAssign', protect, groupController.assignAdmin);
router.delete('/:groupId/leave', protect, groupController.leaveGroup); // Route rời nhóm
module.exports = router;