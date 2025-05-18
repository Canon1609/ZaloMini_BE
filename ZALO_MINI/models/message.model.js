const {
    PutCommand,
    GetCommand,
    UpdateCommand,
    QueryCommand,
    ScanCommand,
    DeleteCommand, // Thêm DeleteCommand nếu chưa có
} = require('@aws-sdk/lib-dynamodb');
const { ddbDocClient } = require('../config/aws.config');
const User = require('./user.model');
const TABLE_NAME = 'message';
const { v4: uuidv4 } = require('uuid');
const s3Client = require('@aws-sdk/client-s3'); // Giả sử bạn đã cấu hình s3Client

const Message = {
    // Lấy danh sách cuộc trò chuyện theo userId
    async getListConversationByUserId(userId) {
        try {
            const params = {
                TableName: TABLE_NAME,
                FilterExpression: 'senderId = :userId OR receiverId = :userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
            };
            const { Items: allMessages } = await ddbDocClient.send(new ScanCommand(params));
            if (!allMessages || allMessages.length === 0) {
                return [];
            }

            const conversationsMap = new Map();
            for (const msg of allMessages) {
                const otherUserId = msg.senderId === userId ? msg.receiverId : msg.senderId;
                const conversationId = msg.conversationId;

                if (!conversationsMap.has(conversationId)) {
                    const otherUser = await User.getUserById(otherUserId);
                    conversationsMap.set(conversationId, {
                        userId: otherUserId,
                        username: otherUser.username,
                        avatarUrl: otherUser.avatarUrl,
                        lastMessage: msg.content || (msg.isRecalled ? 'Tin nhắn đã được thu hồi' : ''),
                        time: msg.timestamp,
                        messages: [],
                    });
                }

                const conversation = conversationsMap.get(conversationId);
                conversation.messages.push(msg);

                if (new Date(msg.timestamp) > new Date(conversation.time)) {
                    conversation.lastMessage = msg.content || (msg.isRecalled ? 'Tin nhắn đã được thu hồi' : '');
                    conversation.time = msg.timestamp;
                }
            }

            const conversations = Array.from(conversationsMap.values()).map((conv) => {
                const unread = conv.messages.filter(
                    (msg) => msg.receiverId === userId && !msg.isRead && !msg.isRecalled
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

            conversations.sort((a, b) => new Date(b.time) - new Date(a.time));
            return conversations;
        } catch (error) {
            console.error('Lỗi khi lấy danh sách cuộc trò chuyện:', error);
            throw new Error(`Lỗi server: ${error.message}`);
        }
    },

    // Lưu tin nhắn vào bảng message
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
                isRead: message.isRead || false,
                isRecalled: message.isRecalled || false, // Thêm isRecalled với giá trị mặc định
            },
        };
        await ddbDocClient.send(new PutCommand(params));
        return message;
    },

    // Xóa tin nhắn
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

    // Thu hồi tin nhắn
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
                UpdateExpression: 'SET #isRecalled = :isRecalled, #content = :content, #fileUrl = :fileUrl, #type = :type',
                ExpressionAttributeNames: {
                    '#isRecalled': 'isRecalled',
                    '#content': 'content',
                    '#fileUrl': 'fileUrl',
                    '#type': 'type', // Sửa contentType thành type
                },
                ExpressionAttributeValues: {
                    ':isRecalled': true,
                    ':content': 'Tin nhắn đã được thu hồi',
                    ':fileUrl': null,
                    ':type': 'text',
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

    // Đánh dấu tin nhắn đã đọc
    async markMessagesAsRead(conversationId, userId) {
        try {
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

    // Lấy tin nhắn theo conversationId
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
            const messages = Items ? Items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
            // Đảm bảo mọi tin nhắn có thuộc tính isRecalled
            return messages.map(msg => ({
                ...msg,
                isRecalled: msg.isRecalled ?? false, // Nếu không có isRecalled, mặc định là false
            }));
        } catch (err) {
            console.error('Error fetching messages by conversation:', err);
            throw new Error(`Không thể lấy tin nhắn: ${err.message}`);
        }
    },
};

module.exports = Message;