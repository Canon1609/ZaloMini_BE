const e = require('express');
const { ddbDocClient } = require('../config/aws.config');
const Message = require('../models/message.model');
const uploadImageToS3 = require('../utils/imageS3.util');
const { uploadToS3 } = require('../utils/s3.util');
const { UpdateCommand ,QueryCommand} = require('@aws-sdk/lib-dynamodb');

// Lấy danh sách cuộc trò chuyện của người dùng
exports.getListConversationByUserId = async (req, res) => {
    try {
      const conversations = await Message.getListConversationByUserId(req.params.userId);
      res.json(conversations);
    } catch (err) {
      console.error('Lỗi khi lấy danh sách cuộc trò chuyện:', err);
      res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
    }
  };
  
// Tạo tin nhắn mới
exports.createMessage = async (req, res) => {
    try {
      const { senderId, receiverId, content, type , isRead, timestamp } = req.body;
      let file = req.file;
      let fileUrl = null;
      // Kiểm tra dữ liệu đầu vào
      if (!content && !file) {
        return res.status(400).json({ message: 'Nội dung hoặc file là bắt buộc' });
      }
      // Xử lý upload file lên S3 nếu có
      if (file) {
          const uploadResult = await uploadToS3(file);        
          fileUrl = uploadResult; // Lưu URL của file đã upload
      }   
      // Tạo conversationId bằng cách sắp xếp senderId và receiverId
      const conversationId = [senderId, receiverId].sort().join('#');
      // lọc type nếu là file
      let messageType = type;
      if (fileUrl) {
        const extension = fileUrl.split('.').pop().toLowerCase();
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
        const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        if (imageExtensions.includes(extension)) {
          messageType = 'image';
        } else if (videoExtensions.includes(extension)) {
          messageType = 'video';
        } else {
          messageType = 'file';
        }
      }
     
      // Tạo tin nhắn
      const message = {
        messageId: `${senderId}#${receiverId}#${Date.now()}`,
        senderId,
        receiverId,
        content: content || null,
        type : fileUrl ? messageType : type,
        fileUrl: fileUrl ? fileUrl : null,
        isRead: isRead || false,
        conversationId,
        timestamp: timestamp || new Date().toISOString(),
      };
      // Lưu tin nhắn vào DynamoDB
      const createdMessage = await Message.createMessage(message);
      if (!createdMessage) {
        return res.status(500).json({ message: 'Không thể tạo tin nhắn' });
      }
      res.status(201).json(message);
    } catch (err) {
      console.error('Lỗi khi tạo tin nhắn:', err);
      res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
    }
  };

// Lấy danh sách tin nhắn giữa hai người dùng
exports.getMessagesByConversationId = async (req, res) => {
    const userId = req.params.userId; // userId là selectedUser.userId
    const currentUserId = req.user.userId; // Lấy currentUserId từ token
    try {
      // Tạo conversationId bằng cách sắp xếp userId và currentUserId
      const conversationId = [currentUserId, userId].sort().join('#');
  
      // Truy vấn tin nhắn từ DynamoDB dựa trên conversationId
      const params = {
        TableName: 'message',
        KeyConditionExpression: 'conversationId = :conversationId',
        ExpressionAttributeValues: {
          ':conversationId': conversationId,
        },
      };
  
      const { Items } = await ddbDocClient.send(new QueryCommand(params));
  
      if (!Items) {
        return res.status(200).json([]);
      }
  
      // Sắp xếp tin nhắn theo thời gian (mới nhất cuối cùng)
      const sortedMessages = Items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      res.status(200).json(sortedMessages);
    } catch (error) {
      console.error('Lỗi khi lấy danh sách tin nhắn:', error);
      res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
  };
// Đánh dấu tin nhắn là đã đọc
exports.markMessagesAsRead = async (req, res) => {
  const { conversationId, userId } = req.body;

  if (!conversationId || !userId) {
    return res.status(400).json({ message: 'Thiếu conversationId hoặc userId' });
  }

  try {
    const params = {
      TableName: 'message',
      KeyConditionExpression: 'conversationId = :cid',
      FilterExpression: 'isRead = :isRead AND receiverId = :userId',
      ExpressionAttributeValues: {
        ':cid': conversationId,
        ':isRead': false,
        ':userId': userId,
      },
    };
    const { Items } = await ddbDocClient.send(new QueryCommand(params));
    for (const item of Items) {
      const updateParams = {
        TableName: 'message',
        Key: {
          conversationId: item.conversationId,
          timestamp: item.timestamp,
        },
        UpdateExpression: 'set isRead = :isRead',
        ExpressionAttributeValues: {
          ':isRead': true,
        },
      };
      await ddbDocClient.send(new UpdateCommand(updateParams));
    }

    res.status(200).json({ message: 'Đã đánh dấu tin nhắn là đã đọc' });
  } catch (error) {
    console.error('Lỗi khi đánh dấu tin nhắn đã đọc:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};
exports.deleteMessage = async (req, res) => {
  try {
    const { conversationId, timestamp } = req.body;
    const userId = req.user.userId;

    if (!conversationId || !timestamp) {
      return res.status(400).json({ message: 'Thiếu conversationId hoặc timestamp' });
    }

    const messages = await Message.getMessagesByConversation(conversationId);
    const message = messages.find((msg) => msg.timestamp === timestamp);
    if (!message) {
      return res.status(404).json({ message: 'Tin nhắn không tồn tại' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ message: 'Bạn không có quyền xóa tin nhắn này' });
    }

    await Message.deleteMessage(conversationId, timestamp);
    res.status(200).json({ message: 'Xóa tin nhắn thành công' });
  } catch (err) {
    console.error('Delete message error:', err.stack);
    res.status(500).json({ message: err.message || 'Lỗi máy chủ' });
  }
};

exports.recallMessage = async (req, res) => {
  try {
    const { conversationId, timestamp } = req.body;
    const userId = req.user.userId;

    if (!conversationId || !timestamp) {
      return res.status(400).json({ message: 'Thiếu conversationId hoặc timestamp' });
    }

    const messages = await Message.getMessagesByConversation(conversationId);
    const message = messages.find((msg) => msg.timestamp === timestamp);
    if (!message) {
      return res.status(404).json({ message: 'Tin nhắn không tồn tại' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ message: 'Bạn không có quyền thu hồi tin nhắn này' });
    }

    if (message.isRecalled) {
      return res.status(400).json({ message: 'Tin nhắn đã được thu hồi trước đó' });
    }

    const updatedMessage = await Message.recallMessage(conversationId, timestamp);
    res.status(200).json({ message: 'Thu hồi tin nhắn thành công', data: updatedMessage });
  } catch (err) {
    console.error('Recall message error:', err.stack);
    res.status(500).json({ message: err.message || 'Lỗi máy chủ' });
  }
};

exports.forwardMessage = async (req, res) => {
  try {
    const { conversationId, timestamp, newReceiverId } = req.body;
    const senderId = reqProfessor.user.userId;

    if (!conversationId || !timestamp || !newReceiverId) {
      return res.status(400).json({ message: 'Thiếu conversationId, timestamp hoặc newReceiverId' });
    }

    const messages = await Message.getMessagesByConversation(conversationId);
    const message = messages.find((msg) => msg.timestamp === timestamp);
    if (!message) {
      return res.status(404).json({ message: 'Tin nhắn không tồn tại' });
    }

    const newReceiver = await User.getUserById(newReceiverId);
    if (!newReceiver) {
      return res.status(404).json({ message: 'Người nhận mới không tồn tại' });
    }

    const sortedIds = [senderId, newReceiverId].sort();
    const newConversationId = `${sortedIds[0]}#${sortedIds[1]}`;

    const forwardedMessage = await Message.createMessage({
      conversationId: newConversationId,
      senderId,
      receiverId: newReceiverId,
      content: message.content,
      contentType: message.contentType,
      fileUrl: message.fileUrl,
      isRead: false, // Ensure forwarded message is marked as unread
    });

    res.status(201).json({ message: 'Chuyển tiếp tin nhắn thành công', data: forwardedMessage });
  } catch (err) {
    console.error('Forward message error:', err.stack);
    res.status(500).json({ message: err.message || 'Lỗi máy chủ' });
  }
};