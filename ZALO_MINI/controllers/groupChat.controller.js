// Trong controllers/groupChat.controller.js
const GroupMessage = require('../models/groupMessage.model');
const UserMessage = require('../models/message.model');
const User = require('../models/user.model');
const { uploadToS3 } = require('../utils/s3.util');

exports.sendMessageToGroup = async (req, res) => {
    try {
        const { groupId, content, type } = req.body;
        const senderId = req.user.userId;
        const file = req.file;
        let fileUrl;

        if (!groupId || (!content && !file) || !type) {
            return res.status(400).json({ message: 'Vui lòng cung cấp groupId, nội dung hoặc file, và loại tin nhắn.' });
        }

        if (file) {
            const result = await uploadToS3(file);
            fileUrl = result;
        }

        const message = {
            groupId,
            senderId,
            content: content || null,
            type,
            fileUrl,
        };

        const newMessage = await GroupMessage.createGroupMessage(message);

        // Phát sự kiện Socket.IO cho những người trong nhóm
        const io = req.app.get('socketio');
        io.to(`group_${groupId}`).emit('receiveGroupMessage', newMessage);

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Lỗi khi gửi tin nhắn nhóm:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi gửi tin nhắn.' });
    }
};

exports.getMessagesByGroupId = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { limit, lastEvaluatedKey } = req.query;
        const result = await GroupMessage.getMessagesByGroupId(groupId, parseInt(limit), lastEvaluatedKey);
        res.json(result);
    } catch (error) {
        console.error('Lỗi khi lấy tin nhắn nhóm:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi lấy tin nhắn.' });
    }
};

exports.deleteGroupMessage = async (req, res) => {
    try {
        const { groupId, timestamp } = req.body;
        const senderId = req.user.userId;

        if (!groupId || !timestamp) {
            return res.status(400).json({ message: 'Vui lòng cung cấp groupId và timestamp của tin nhắn cần xóa.' });
        }

        await GroupMessage.deleteGroupMessage(groupId, timestamp, senderId);

        // Phát sự kiện Socket.IO thông báo tin nhắn đã bị xóa
        const io = req.app.get('socketio');
        io.to(`group_${groupId}`).emit('groupMessageDeleted', { groupId, timestamp, senderId });

        res.json({ message: 'Xóa tin nhắn thành công.' });
    } catch (error) {
        console.error('Lỗi khi xóa tin nhắn nhóm:', error);
        res.status(500).json({ message: error.message || 'Đã có lỗi xảy ra khi xóa tin nhắn.' });
    }
};

exports.recallGroupMessage = async (req, res) => {
    try {
        const { messageId, senderId } = req.body; // Get messageId and senderId from request body

        if (!messageId || !senderId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp messageId và senderId của tin nhắn cần thu hồi.' });
        }

        // Kiểm tra xem người gửi có quyền thu hồi tin nhắn không
        const message = await GroupMessage.getMessageById(messageId);  // Sử dụng getMessageById để lấy tin nhắn
        if (!message) {
            return res.status(404).json({ message: 'Không tìm thấy tin nhắn.' });
        }
        if (message.senderId !== senderId) {
            return res.status(403).json({ message: 'Bạn không có quyền thu hồi tin nhắn này.' });
        }

        const recalledMessage = await GroupMessage.recallGroupMessage(messageId, senderId);

        // Phát sự kiện Socket.IO thông báo tin nhắn đã bị thu hồi
        const io = req.app.get('socketio');
        io.to(`group_${recalledMessage.groupId}`).emit('groupMessageRecalled', recalledMessage); // groupId should be in the recalledMessage

        res.json({ message: 'Thu hồi tin nhắn thành công.', data: recalledMessage });
    } catch (error) {
        console.error('Lỗi khi thu hồi tin nhắn nhóm:', error);
        res.status(500).json({ message: error.message || 'Đã có lỗi xảy ra khi thu hồi tin nhắn.' });
    }
};

exports.forwardGroupMessage = async (req, res) => {
    try {
        const { groupId, messageIdToForward, targetUserId, targetGroupId } = req.body;
        const senderId = req.user.userId;

        if (!groupId || !messageIdToForward || (!targetUserId && !targetGroupId)) {
            return res.status(400).json({
                message:
                    'Vui lòng cung cấp groupId nguồn, messageId cần chuyển tiếp và targetUserId hoặc targetGroupId.',
            });
        }

        const originalMessage = await GroupMessage.getMessageById(messageIdToForward);
        if (!originalMessage) {
            return res.status(404).json({ message: 'Không tìm thấy tin nhắn.' });
        }

        let forwardedMessage;

        if (targetGroupId) {
            // Chuyển tiếp đến nhóm (giữ nguyên như trước)
            const targetGroup = await Group.getGroupById(targetGroupId);
            if (!targetGroup) {
                return res.status(404).json({ message: 'Không tìm thấy nhóm đích.' });
            }
            if (!targetGroup.members.some(member => member.userId === senderId)) {
                return res
                    .status(403)
                    .json({ message: 'Bạn không phải là thành viên của nhóm đích.' });
            }
            forwardedMessage = {
                groupId: targetGroupId,
                senderId: senderId,
                content: originalMessage.content,
                type: originalMessage.type,
                fileUrl: originalMessage.fileUrl,
                timestamp: new Date().toISOString(), 
            };
            const newMessage = await GroupMessage.createGroupMessage(forwardedMessage);
            const io = req.app.get('socketio');
            io.to(`group_${targetGroupId}`).emit('receiveGroupMessage', newMessage);
        } else if (targetUserId) {
            // Chuyển tiếp đến người dùng
            if (targetUserId === senderId) {
                return res
                    .status(400)
                    .json({ message: 'Không thể chuyển tiếp tin nhắn cho chính mình' });
            }
            const targetUser = await User.getUserById(targetUserId);
            if (!targetUser) {
                return res.status(404).json({ message: 'Người nhận không tồn tại' });
            }
            const sortedIds = [senderId, targetUserId].sort();
            const newConversationId = `${sortedIds[0]}#${sortedIds[1]}`;

            forwardedMessage = await UserMessage.createMessage({
                conversationId: newConversationId,
                senderId: senderId,
                receiverId: targetUserId,
                content: originalMessage.content,
                contentType: originalMessage.type,
                fileUrl: originalMessage.fileUrl,
                isRead: false,
                timestamp: new Date().toISOString(), // Add timestamp here
            });
            const io = req.app.get('socketio');
            io.to(`user_${targetUserId}`).emit('receiveMessage', forwardedMessage);
        }

        res.status(201).json({ message: 'Chuyển tiếp tin nhắn thành công.', data: forwardedMessage });
    } catch (error) {
        console.error('Lỗi khi chuyển tiếp tin nhắn:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi chuyển tiếp tin nhắn.' });
    }
};