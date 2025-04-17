const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const User = require('./user.model'); 

const FriendModel = {
  async sendRequest(fromEmail, toEmail) {
    const requestId = uuidv4();
    const item = {
      requestId,
      fromEmail,
      toEmail,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await dynamoDb
      .put({
        TableName: 'FriendRequests',
        Item: item,
      })
      .promise();
    return item;
  },

  async getRequests(toEmail) {
    const res = await dynamoDb
      .query({
        TableName: 'FriendRequests',
        IndexName: 'toEmail-index',
        KeyConditionExpression: 'toEmail = :toEmail',
        FilterExpression: '#s = :status',
        ExpressionAttributeNames: {
          '#s': 'status',
        },
        ExpressionAttributeValues: {
          ':toEmail': toEmail,
          ':status': 'pending',
        },
      })
      .promise();
    return res.Items;
  },

  async acceptRequest(requestId) {
    const requestRes = await dynamoDb
      .get({
        TableName: 'FriendRequests',
        Key: { requestId },
      })
      .promise();
    const request = requestRes.Item;
    if (!request) throw new Error('Request not found');

    await dynamoDb
      .update({
        TableName: 'FriendRequests',
        Key: { requestId },
        UpdateExpression: 'set #s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'accepted' },
      })
      .promise();

    const friendshipId = uuidv4();
    const friendItem = {
      friendshipId,
      user1Email: request.fromEmail,
      user2Email: request.toEmail,
      createdAt: new Date().toISOString(),
    };
    await dynamoDb
      .put({
        TableName: 'Friends',
        Item: friendItem,
      })
      .promise();

    return friendItem;
  },

  async declineRequest(requestId) {
    await dynamoDb
      .update({
        TableName: 'FriendRequests',
        Key: { requestId },
        UpdateExpression: 'set #s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'declined' },
      })
      .promise();
  },

  async removeFriend(email1, email2) {
    const scan = await dynamoDb
      .scan({
        TableName: 'Friends',
        FilterExpression:
          '(user1Email = :e1 and user2Email = :e2) or (user1Email = :e2 and user2Email = :e1)',
        ExpressionAttributeValues: {
          ':e1': email1,
          ':e2': email2,
        },
      })
      .promise();

    const friend = scan.Items[0];
    if (!friend) throw new Error('Friendship not found');

    await dynamoDb
      .delete({
        TableName: 'Friends',
        Key: { friendshipId: friend.friendshipId },
      })
      .promise();
  },

  async getFriends(email) {
    const scan = await dynamoDb
      .scan({
        TableName: 'Friends',
        FilterExpression: 'user1Email = :email OR user2Email = :email',
        ExpressionAttributeValues: {
          ':email': email,
        },
      })
      .promise();

    const friends = await Promise.all(
      scan.Items.map(async (item) => {
        const friendEmail = item.user1Email === email ? item.user2Email : item.user1Email;
        const user = await User.getUserByEmail(friendEmail);
        return {
          email: friendEmail,
          username: user ? user.username || '' : '',
          avatarUrl: user ? user.avatarUrl || '' : ''
          // Thêm các trường khác nếu cần, ví dụ: avatar
          // avatar: user ? user.avatar || '' : ''
        };
      })
    );

    return friends;
  },
};

module.exports = FriendModel;