const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friend.controller');
const { protect } = require('../middleware/auth.middleware');

router.post('/request', protect, friendController.sendFriendRequest);
router.get('/requests/received', protect, friendController.getReceivedRequests);
router.post('/accept', protect, friendController.acceptRequest);
router.post('/decline', protect, friendController.declineRequest);
router.delete('/remove', protect, friendController.removeFriend);
router.get('/list', protect, friendController.getFriendList);

module.exports = router;
