const {
    PutCommand,
    GetCommand,
    UpdateCommand,
    QueryCommand,ScanCommand
  } = require('@aws-sdk/lib-dynamodb');
  const { ddbDocClient } = require('../config/aws.config');
  const User = require('./user.model');
  const TABLE_NAME = 'message';
  const { v4: uuidv4 } = require('uuid');
  const Message = {
    // lấy tin nhắn theo senderId
    async getListConversationByUserId(userId) {
      try {
        // Sử dụng ScanCommand để lấy tất cả tin nhắn có senderId hoặc receiverId là userId
        const params = {
          TableName: TABLE_NAME,
          FilterExpression: 'senderId = :userId OR receiverId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        };
        //  Gọi DynamoDB để lấy tất cả tin nhắn
        const { Items: allMessages } = await ddbDocClient.send(new ScanCommand(params));
        // Kiểm tra xem có tin nhắn nào không 
        if (!allMessages || allMessages.length === 0) {
          return []; // Trả về mảng rỗng nếu không có tin nhắn nào
        }
    
        // Nhóm tin nhắn theo conversationId
        const conversationsMap = new Map();
       //  Lặp qua tất cả tin nhắn và nhóm theo conversationId
       //
        for (const msg of allMessages) {
          // Kiểm tra xem tin nhắn có liên quan đến người dùng hiện tại không
          const otherUserId = msg.senderId === userId ? msg.receiverId : msg.senderId;
          // Kiểm tra xem tin nhắn có phải là của người dùng hiện tại không
          const conversationId = msg.conversationId;
          // Kiểm tra xem cuộc trò chuyện đã tồn tại trong bản đồ chưa
          if (!conversationsMap.has(conversationId)) {
            // Nếu chưa, tạo một đối tượng cuộc trò chuyện mới
            const otherUser = await User.getUserById(otherUserId);
            conversationsMap.set(conversationId, {
              userId: otherUserId,
              username: otherUser.username,
              avatarUrl: otherUser.avatarUrl,
              lastMessage: msg.content,
              time: msg.timestamp,
              messages: [],
            });
          }
    
          const conversation = conversationsMap.get(conversationId);
          conversation.messages.push(msg);
    
          // Cập nhật tin nhắn cuối cùng
          if (new Date(msg.timestamp) > new Date(conversation.time)) {
            conversation.lastMessage = msg.content;
            conversation.time = msg.timestamp;
          }
        }
    
        // Tính số tin nhắn chưa đọc và định dạng dữ liệu trả về
        const conversations = Array.from(conversationsMap.values()).map((conv) => {
          const unread = conv.messages.filter(
            (msg) => msg.receiverId === userId && !msg.isRead
          ).length;
    
          return {
            userId: conv.userId,
            username: conv.username,
            avatarUrl: conv.avatarUrl,
            lastMessage: conv.lastMessage,
            time: conv.time,
            unread,
          };
        });
    
        // Sắp xếp theo thời gian (mới nhất trước)
        conversations.sort((a, b) => new Date(b.time) - new Date(a.time));
       return conversations
      } catch (error) {
        console.error('Lỗi khi lấy danh sách cuộc trò chuyện:', error);
        res.status(500).json({ message: 'Lỗi server', error: error.message });
      }
    },

    // lưu tin nhắn vào bảng message
    async createMessage(message) {
      const params = {
        TableName: TABLE_NAME,
        Item: {
          messageId: uuidv4(),
          conversationId: message.conversationId,
          timestamp: message.timestamp,
          senderId: message.senderId,
          receiverId: message.receiverId,
          content: message.content,
          fileUrl: message.fileUrl,
          type: message.type,
          isRead: false,
        },
      };
      await ddbDocClient.send(new PutCommand(params));
      return message;
    },
  }
  
  module.exports = Message;
  