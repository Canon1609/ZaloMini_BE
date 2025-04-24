const {
    PutCommand,
    GetCommand,
    UpdateCommand,
    QueryCommand,
    ScanCommand,
    DeleteCommand
} = require('@aws-sdk/lib-dynamodb');
const { ddbDocClient } = require('../config/aws.config');
const generateUUID = require('../utils/uuid.util');

const TABLE_NAME = 'group'; // Tên bảng nhóm của bạn

const Group = {
    async createGroup(data) {
        const groupId = generateUUID();
        const createdAt = new Date().toISOString();

        const newGroup = {
            groupId,
            name: data.name,
            ownerId: data.ownerId,
            members: data.members,
            createdAt
        };

        const params = {
            TableName: TABLE_NAME,
            Item: newGroup
        };

        await ddbDocClient.send(new PutCommand(params));
        return newGroup;
    },

    async getGroupById(groupId) {
        const params = {
            TableName: TABLE_NAME,
            Key: { groupId }
        };
        const data = await ddbDocClient.send(new GetCommand(params));
        return data.Item || null;
    },
    async getGroupsByUserId(userId) {
        const params = {
            TableName: TABLE_NAME,
        };
        const data = await ddbDocClient.send(new ScanCommand(params));
        if (!data.Items) {
            return [];
        }
        return data.Items.filter(group =>
            group.members && group.members.some(member => member.userId === userId)
        );
    },

    // Các hàm khác cho quản lý nhóm (thêm thành viên, xóa thành viên, ...)
    // Các hàm khác cho quản lý nhóm (thêm thành viên, xóa thành viên, ...)
    async addMember(groupId, userId, role = 'member') {
        const params = {
            TableName: TABLE_NAME,
            Key: { groupId },
            UpdateExpression:
                'SET #members = list_append(if_not_exists(#members, :empty_list), :member)',
            ExpressionAttributeNames: {
                '#members': 'members',
            },
            ExpressionAttributeValues: {
                ':member': [{ userId, role }],
                ':empty_list': [],
            },
            ReturnValues: 'UPDATED_NEW',
        };
        await ddbDocClient.send(new UpdateCommand(params));
    },

    async removeMember(groupId, userId) {
        const group = await this.getGroupById(groupId);
        if (!group || !group.members) {
            return;
        }

        const memberIndex = group.members.findIndex((member) => member.userId === userId);
        if (memberIndex > -1) {
            const params = {
                TableName: TABLE_NAME,
                Key: { groupId },
                UpdateExpression: `REMOVE #members[${memberIndex}]`,
                ExpressionAttributeNames: {
                    '#members': 'members',
                },
                ReturnValues: 'UPDATED_OLD',
            };
            await ddbDocClient.send(new UpdateCommand(params));
        }
    },

    async disbandGroup(groupId) {
        const params = {
            TableName: TABLE_NAME,
            Key: { groupId },
        };
        await ddbDocClient.send(new DeleteCommand(params));
    },

    async updateMemberRole(groupId, userId, role) {
        const group = await this.getGroupById(groupId);
        if (!group || !group.members) {
            return;
        }

        const memberIndex = group.members.findIndex((member) => member.userId === userId);
        if (memberIndex > -1) {
            const updateExpression = `SET #members[${memberIndex}].#role = :role`;
            const expressionAttributeNames = {
                '#members': 'members',
                '#role': 'role',
            };
            const expressionAttributeValues = {
                ':role': role,
            };

            const params = {
                TableName: TABLE_NAME,
                Key: { groupId },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'UPDATED_NEW',
            };
            await ddbDocClient.send(new UpdateCommand(params));
        }
    },

    async getOwnerId(groupId) {
        const group = await this.getGroupById(groupId);
        return group ? group.ownerId : null;
    },
};

module.exports = Group;