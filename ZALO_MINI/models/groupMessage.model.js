// Trong models/groupMessage.model.js
const {
    PutCommand,
    GetCommand,
    UpdateCommand,
    QueryCommand,
    DeleteCommand,
    ScanCommand
} = require('@aws-sdk/lib-dynamodb');
const { ddbDocClient } = require('../config/aws.config');
const { v4: uuidv4 } = require('uuid');

const TABLE_NAME = 'groupMessage'; // Tên bảng tin nhắn nhóm của bạn

const GroupMessage = {
    async createGroupMessage(message) {
        const params = {
            TableName: TABLE_NAME,
            Item: {
                messageId: uuidv4(),
                groupId: message.groupId,
                senderId: message.senderId,
                content: message.content,
                type: message.type, // 'text', 'file', 'image', 'video', 'emoji'
                fileUrl: message.fileUrl,
                timestamp: new Date().toISOString(),
                isRecalled: false,
            },
        };
        await ddbDocClient.send(new PutCommand(params));
        return params.Item;
    },

     // SỬA ĐỔI ĐỂ HIỂN THỊ CUỘC TRÒ CHUYỆN NHÓM
     async getMessagesByGroupId(groupId, limit = 50, lastEvaluatedKey) {
        // LƯU Ý: Vì messageId là khóa chính, chúng ta KHÔNG THỂ sử dụng QueryCommand ở đây.
        // Chúng ta BẮT BUỘC phải dùng ScanCommand (kém hiệu quả hơn).

        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'groupId = :groupId', // Lọc theo groupId
            ExpressionAttributeValues: {
                ':groupId': groupId,
            },
            Limit: limit, // Giới hạn số lượng tin nhắn trả về mỗi lần
            ExclusiveStartKey: lastEvaluatedKey, // Để phân trang
        };

        try {
            const data = await ddbDocClient.send(new ScanCommand(params));
            const items = data.Items || [];

            // Sắp xếp tin nhắn theo timestamp (mới nhất trước)
            items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

            return {
                items: items,
                lastEvaluatedKey: data.LastEvaluatedKey,
            };
        } catch (error) {
            console.error("Lỗi khi lấy tin nhắn nhóm:", error);
            throw error;
        }
    },

    async getMessageById(messageId) {
        const params = {
            TableName: TABLE_NAME,
            Key: {
                messageId: messageId, // Lấy tin nhắn theo messageId
            },
        };
        try {
            const data = await ddbDocClient.send(new GetCommand(params));
            return data.Item || null;
        } catch (error) {
            console.error("Lỗi khi lấy tin nhắn theo messageId:", error);
            throw error;
        }
    },

    async deleteGroupMessage(groupId, timestamp, senderId) {
        try {
            const messageToDelete = await this.getMessageById(groupId, timestamp);
            if (!messageToDelete) {
                throw new Error('Tin nhắn không tồn tại hoặc không thuộc nhóm này.');
            }
            if (messageToDelete.senderId !== senderId) {
                throw new Error('Bạn không có quyền xóa tin nhắn này.');
            }

            const params = {
                TableName: TABLE_NAME,
                Key: {
                    groupId,
                    timestamp,
                },
            };
            await ddbDocClient.send(new DeleteCommand(params));
            return { message: 'Xóa tin nhắn thành công.' };
        } catch (error) {
            console.error('Lỗi khi xóa tin nhắn nhóm:', error);
            throw error;
        }
    },

    async recallGroupMessage(messageId, senderId) {
        try {
            // LẤY TIN NHẮN BẰNG messageId
            const messageToRecall = await this.getMessageById(messageId);
            if (!messageToRecall) {
                throw new Error('Tin nhắn không tồn tại.');
            }
            if (messageToRecall.senderId !== senderId) {
                throw new Error('Bạn không có quyền thu hồi tin nhắn này.');
            }
            if (messageToRecall.isRecalled) {
                return { message: 'Tin nhắn này đã được thu hồi trước đó.' };
            }

            const params = {
                TableName: TABLE_NAME,
                Key: {
                    messageId: messageId, // Dùng messageId làm key
                },
                UpdateExpression: 'SET isRecalled = :isRecalled, content = :content, fileUrl = :fileUrl',
                ExpressionAttributeValues: {
                    ':isRecalled': true,
                    ':content': 'Tin nhắn đã được thu hồi.',
                    ':fileUrl': null,
                },
                ReturnValues: 'ALL_NEW',
            };
            const result = await ddbDocClient.send(new UpdateCommand(params));
            return result.Attributes;
        } catch (error) {
            console.error('Lỗi khi thu hồi tin nhắn nhóm:', error);
            throw error;
        }
    },

    // Chức năng chuyển tiếp tin nhắn có thể phức tạp hơn,
    // bạn có thể tạo một hàm riêng hoặc xử lý ở tầng controller tùy theo logic.
    
};

module.exports = GroupMessage;