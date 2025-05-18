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
  async deleteMessage(conversationId, timestamp) {
    try {
      const queryParams = {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'conversationId = :cid AND #ts = :ts',
        ExpressionAttributeNames: {
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':cid': conversationId,
          ':ts': timestamp,
        },
      };

      const { Items } = await ddbDocClient.send(new QueryCommand(queryParams));
      if (!Items || Items.length === 0) {
        throw new Error('Tin nhắn không tồn tại');
      }

      const message = Items[0];

      if (message.fileUrl) {
        const fileKey = message.fileUrl.split('/').slice(-2).join('/');
        const deleteParams = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: fileKey,
        };
        await s3Client.send(new DeleteObjectCommand(deleteParams));
        console.log(`File deleted from S3: ${fileKey}`);
      }

      const deleteParams = {
        TableName: TABLE_NAME,
        Key: {
          conversationId,
          timestamp,
        },
      };

      await ddbDocClient.send(new DeleteCommand(deleteParams));
      console.log('Message deleted:', { conversationId, timestamp });
      return { message: 'Xóa tin nhắn thành công' };
    } catch (err) {
      console.error('Delete message error:', err);
      throw new Error(`Không thể xóa tin nhắn: ${err.message}`);
    }
  },

  async recallMessage(conversationId, timestamp) {
    try {
      const queryParams = {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'conversationId = :cid AND #ts = :ts',
        ExpressionAttributeNames: {
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':cid': conversationId,
          ':ts': timestamp,
        },
      };

      const { Items } = await ddbDocClient.send(new QueryCommand(queryParams));
      if (!Items || Items.length === 0) {
        throw new Error('Tin nhắn không tồn tại');
      }

      const message = Items[0];

      const messageTime = new Date(message.timestamp).getTime();
      const currentTime = new Date().getTime();
      const timeDiff = (currentTime - messageTime) / 1000;
      if (timeDiff > 300) {
        throw new Error('Không thể thu hồi tin nhắn sau 5 phút');
      }

      if (message.fileUrl) {
        const fileKey = message.fileUrl.split('/').slice(-2).join('/');
        const deleteParams = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: fileKey,
        };
        await s3Client.send(new DeleteObjectCommand(deleteParams));
        console.log(`File deleted from S3: ${fileKey}`);
      }

      const updateParams = {
        TableName: TABLE_NAME,
        Key: {
          conversationId,
          timestamp,
        },
        UpdateExpression: 'SET #isRecalled = :isRecalled, #content = :content, #fileUrl = :fileUrl, #contentType = :contentType',
        ExpressionAttributeNames: {
          '#isRecalled': 'isRecalled',
          '#content': 'content',
          '#fileUrl': 'fileUrl',
          '#contentType': 'contentType',
        },
        ExpressionAttributeValues: {
          ':isRecalled': true,
          ':content': 'Tin nhắn đã được thu hồi',
          ':fileUrl': null,
          ':contentType': 'text',
        },
        ReturnValues: 'ALL_NEW',
      };

      const updatedMessage = await ddbDocClient.send(new UpdateCommand(updateParams));
      console.log('Message recalled:', updatedMessage.Attributes);
      return updatedMessage.Attributes;
    } catch (err) {
      console.error('Recall message error:', err);
      throw new Error(`Không thể thu hồi tin nhắn: ${err.message}`);
    }
  },

  async markMessagesAsRead(conversationId, userId) {
    try {
      // Fetch all messages in the conversation
      const queryParams = {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'conversationId = :cid',
        ExpressionAttributeValues: {
          ':cid': conversationId,
        },
      };

      const { Items } = await ddbDocClient.send(new QueryCommand(queryParams));
      if (!Items || Items.length === 0) {
        return { message: 'Không có tin nhắn để đánh dấu đã xem' };
      }

      // Update messages where the user is the receiver and isRead is false
      const updates = Items.filter(
        (msg) => msg.receiverId === userId && !msg.isRead && !msg.isRecalled
      ).map(async (msg) => {
        const updateParams = {
          TableName: TABLE_NAME,
          Key: {
            conversationId,
            timestamp: msg.timestamp,
          },
          UpdateExpression: 'SET #isRead = :isRead',
          ExpressionAttributeNames: {
            '#isRead': 'isRead',
          },
          ExpressionAttributeValues: {
            ':isRead': true,
          },
          ReturnValues: 'ALL_NEW',
        };

        return ddbDocClient.send(new UpdateCommand(updateParams));
      });

      await Promise.all(updates);
      console.log(`Marked messages as read for conversation ${conversationId}`);
      return { message: 'Đánh dấu tin nhắn đã xem thành công' };
    } catch (err) {
      console.error('Mark messages as read error:', err);
      throw new Error(`Không thể đánh dấu tin nhắn đã xem: ${err.message}`);
    }
  },
  //Khôi SửaSửa
  async getMessagesByConversation(conversationId) {
    try {
      const params = {
        TableName: TABLE_NAME,
        KeyConditionExpression: 'conversationId = :cid',
        ExpressionAttributeValues: {
          ':cid': conversationId,
        },
      };
      const { Items } = await ddbDocClient.send(new QueryCommand(params));
      return Items ? Items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
    } catch (err) {
      console.error('Error fetching messages by conversation:', err);
      throw new Error(`Không thể lấy tin nhắn: ${err.message}`);
    }
  },
}

module.exports = Message;
