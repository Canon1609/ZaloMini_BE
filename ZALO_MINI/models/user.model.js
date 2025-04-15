const {
    PutCommand,
    GetCommand,
    UpdateCommand,
    QueryCommand
  } = require('@aws-sdk/lib-dynamodb');
  const { ddbDocClient } = require('../config/aws.config');
  const generateUUID = require('../utils/uuid.util');
  
  const TABLE_NAME = 'user';
  
  const User = {
    async createUser(data) {
      const userId = generateUUID();
      console.log("userId:", userId);
      const createdAt = new Date().toISOString();
  
      const newUser = {
        userId,
        email: data.email,
        passwordHash: data.passwordHash,
        username: data.username,
        avatarUrl: 'https://up-load-file-tranquocanh.s3.amazonaws.com/default-avatar.png',
        isVerified: false,
        role: 'user',
        createdAt
      };
  
      console.log('newUser object:', newUser);
  
      const params = {
        TableName: TABLE_NAME,
        Item: newUser
      };
  
      await ddbDocClient.send(new PutCommand(params));
      return newUser;
    },
  
    async getUserByEmail(email) {
      const params = {
        TableName: TABLE_NAME,
        IndexName: 'email-index', // Bạn phải tạo GSI trước trong DynamoDB Console
        KeyConditionExpression: 'email = :e',
        ExpressionAttributeValues: {
          ':e': email
        }
      };
  
      const data = await ddbDocClient.send(new QueryCommand(params));
      return data.Items && data.Items.length > 0 ? data.Items[0] : null;
    },
  
    async getUserById(userId) {
      const params = {
        TableName: TABLE_NAME,
        Key: { userId }
      };
  
      const data = await ddbDocClient.send(new GetCommand(params));
      return data.Item || null;
    },
  
    async updateUser(userId, updateFields) {
      const updateExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};
  
      for (const key in updateFields) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updateFields[key];
      }
  
      const params = {
        TableName: TABLE_NAME,
        Key: { userId },
        UpdateExpression: 'SET ' + updateExpressions.join(', '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
      };
  
      await ddbDocClient.send(new UpdateCommand(params));
    }
  };

  //
  
  module.exports = User;
  