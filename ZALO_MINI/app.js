require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const chatRoutes = require('./routes/chat.routes');
const server = http.createServer(app);
const Message = require('./models/message.model');
const User = require('./models/user.model');
const FriendModel = require('./models/friend.model');
const friendRoutes = require('./routes/friend.routes');
const groupRoutes = require('./routes/group.routes');
const groupChatRoutes = require('./routes/groupChat.routes');
const GroupMessage = require('./models/groupMessage.model');
const Group = require('./models/group.model');

// Cấu hình CORS chung cho cả Express và Socket.IO
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:8081',
    'http://10.0.2.2:5000',
    'http://localhost:5000',
  ],
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  },
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/friend', friendRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/group-chat', groupChatRoutes);
app.set('views', './views');
app.set('socketio', io);

// Middleware xác thực token cho Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.log('Không có token được cung cấp, đang ngắt kết nối:', socket.id);
    return next(new Error('Không có token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId; // Gán userId vào socket
    socket.join(socket.userId); // Tham gia room với userId
    console.log(`Người dùng ${socket.userId} đã tham gia room`);
    next();
  } catch (err) {
    console.log('Token không hợp lệ, đang ngắt kết nối:', socket.id);
    return next(new Error('Token không hợp lệ'));
  }
});

io.on('connection', (socket) => {
  console.log(`Người dùng ${socket.userId} đã kết nối với socket ID: ${socket.id}`);

  // Gửi tin nhắn chat đơn
  socket.on('sendMessage', async (data) => {
    console.log('Received sendMessage:', data);
    const { senderId, receiverId, content, type, fileUrl, timestamp, conversationId, messageId } = data;

    if (!senderId || !receiverId || !conversationId || !messageId || (!content && !fileUrl)) {
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc: senderId, receiverId, conversationId, messageId, hoặc nội dung/file' });
      console.error('Invalid message data:', data);
      return;
    }

    if (senderId !== socket.userId) {
      socket.emit('error', { message: 'Không có quyền gửi tin nhắn từ người dùng này' });
      console.error('Sender ID mismatch:', { senderId, userId: socket.userId });
      return;
    }

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

    const message = {
      messageId,
      senderId,
      receiverId,
      content: content || null,
      type: messageType,
      fileUrl: fileUrl || null,
      timestamp: timestamp || new Date().toISOString(),
      conversationId,
      isRead: false,
      isRecalled: false,
    };

    try {
      const savedMessage = await Message.createMessage(message);
      console.log('Message saved to DynamoDB:', savedMessage);
      socket.to(receiverId).emit(`receiveMessage_${receiverId}`, savedMessage);
      socket.emit(`receiveMessage_${senderId}`, savedMessage);
      console.log(`Sent receiveMessage_${receiverId} and receiveMessage_${senderId}:`, savedMessage);
    } catch (error) {
      console.error('Lỗi lưu tin nhắn:', error);
      socket.emit('error', { message: 'Lỗi lưu tin nhắn: ' + error.message });
    }
  });

  // Gửi lời mời kết bạn
  socket.on('sendFriendRequest', async (data) => {
    const { senderId, receiverEmail } = data;
    try {
      const sender = await User.getUserById(senderId);
      const receiver = await User.getUserByEmail(receiverEmail);
      if (!receiver) {
        socket.emit('error', { message: 'Không tìm thấy người dùng' });
        return;
      }
      if (receiver.email === sender.email) {
        socket.emit('error', { message: 'Không thể kết bạn với chính mình' });
        return;
      }
      const friends = await FriendModel.getFriends(sender.email);
      if (friends.some(friend => friend.email === receiver.email)) {
        socket.emit('error', { message: 'Đã là bạn bè' });
        return;
      }
      const requests = await FriendModel.getRequests(receiver.email);
      if (requests.some((req) => req.fromEmail === sender.email)) {
        socket.emit('error', { message: 'Đã gửi lời mời rồi' });
        return;
      }

      const request = await FriendModel.sendRequest(sender.email, receiver.email);
      io.to(receiver.userId).emit(`receiveFriendRequest_${receiver.userId}`, {
        requestId: request.requestId,
        senderId,
        senderEmail: sender.email,
        senderUsername: sender.username || '',
        senderAvatarUrl: sender.avatarUrl || '',
        createdAt: request.createdAt,
      });

      socket.emit('friendRequestSent', { message: 'Lời mời đã gửi', requestId: request.requestId });
    } catch (error) {
      console.error('Lỗi gửi lời mời kết bạn:', error);
      socket.emit('error', { message: 'Lỗi gửi lời mời kết bạn' });
    }
  });

  // Chấp nhận lời mời kết bạn
  socket.on('acceptFriendRequest', async (data) => {
    const { requestId, userId } = data;
    try {
      const currentEmail = (await User.getUserById(userId)).email;
      const request = await FriendModel.getRequests(currentEmail).then((requests) =>
        requests.find((r) => r.requestId === requestId)
      );
      if (!request) {
        socket.emit('error', { message: 'Không hợp lệ hoặc không có quyền' });
        return;
      }

      const friendItem = await FriendModel.acceptRequest(requestId);

      const sender = await User.getUserByEmail(request.fromEmail);
      io.to(sender.userId).emit(`friendRequestAccepted_${sender.userId}`, {
        friend: { userId: userId, email: currentEmail, username: (await User.getUserById(userId)).username || '' },
      });

      io.to(userId).emit(`friendRequestAccepted_${userId}`, {
        friend: { userId: sender.userId, email: request.fromEmail, username: sender.username || '' },
      });

      socket.emit('friendRequestAccepted', { message: 'Kết bạn thành công' });
    } catch (error) {
      console.error('Lỗi chấp nhận lời mời:', error);
      socket.emit('error', { message: 'Lỗi chấp nhận lời mời' });
    }
  });

  // Từ chối lời mời kết bạn
  socket.on('declineFriendRequest', async (data) => {
    const { requestId, userId } = data;
    try {
      const currentEmail = (await User.getUserById(userId)).email;
      const request = await FriendModel.getRequests(currentEmail).then((requests) =>
        requests.find((r) => r.requestId === requestId)
      );
      if (!request) {
        socket.emit('error', { message: 'Không hợp lệ hoặc không có quyền' });
        return;
      }

      await FriendModel.declineRequest(requestId);

      const sender = await User.getUserByEmail(request.fromEmail);
      io.to(sender.userId).emit(`friendRequestDeclined_${sender.userId}`, {
        receiverId: userId,
        receiverEmail: currentEmail,
      });

      socket.emit('friendRequestDeclined', { message: 'Đã từ chối lời mời' });
    } catch (error) {
      console.error('Lỗi từ chối lời mời:', error);
      socket.emit('error', { message: 'Lỗi từ chối lời mời' });
    }
  });

  // Xóa bạn bè
  socket.on('removeFriend', async (data) => {
    const { userId, friendEmail } = data;
    try {
      const currentEmail = (await User.getUserById(userId)).email;
      const friend = await User.getUserByEmail(friendEmail);
      if (!friend) {
        socket.emit('error', { message: 'Không tìm thấy người dùng' });
        return;
      }

      await FriendModel.removeFriend(currentEmail, friend.email);

      io.to(friend.userId).emit(`friendRemoved_${friend.userId}`, {
        friendId: userId,
        friendEmail: currentEmail,
      });

      socket.emit('friendRemoved', { message: 'Đã xóa bạn' });
    } catch (error) {
      console.error('Lỗi xóa bạn bè:', error);
      socket.emit('error', { message: 'Lỗi xóa bạn bè' });
    }
  });

  // --- XỬ LÝ SOCKET.IO CHO CHAT NHÓM ---

  socket.on('joinGroup', (groupId) => {
    socket.join(`group_${groupId}`);
    console.log(`Người dùng ${socket.userId} đã tham gia nhóm ${groupId}`);
  });

  socket.on('leaveGroup', (groupId) => {
    socket.leave(`group_${groupId}`);
    console.log(`Người dùng ${socket.userId} đã rời nhóm ${groupId}`);
  });

  socket.on('sendGroupMessage', async (data) => {
    const { groupId, content, type, fileUrl, senderId, timestamp } = data;
    if (!groupId || (!content && !fileUrl) || !type || !senderId) {
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc để gửi tin nhắn.' });
      return;
    }

    if (senderId !== socket.userId) {
      socket.emit('error', { message: 'Không có quyền gửi tin nhắn từ người dùng này.' });
      return;
    }

    try {
      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Nhóm không tồn tại.' });
        return;
      }

      const isMember = group.members.some((member) => member.userId === socket.userId);
      if (!isMember) {
        socket.emit('error', { message: 'Bạn không có quyền gửi tin nhắn trong nhóm này.' });
        return;
      }

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

      const messageId = `${groupId}#${socket.userId}#${Date.now()}`;
      const message = {
        messageId,
        senderId: socket.userId,
        content: content || null,
        type: messageType,
        fileUrl: fileUrl || null,
        isRecalled: false,
        timestamp: timestamp || new Date().toISOString(),
        groupId,
      };

      const savedMessage = await GroupMessage.createGroupMessage(message);
      io.to(`group_${groupId}`).emit('receiveGroupMessage', savedMessage);
    } catch (error) {
      console.error('Lỗi khi gửi tin nhắn nhóm:', error);
      socket.emit('error', { message: 'Không thể gửi tin nhắn: ' + error.message });
    }
  });

  socket.on('deleteGroupMessage', async (data) => {
    const { groupId, timestamp } = data;
    if (!groupId || !timestamp) return;

    try {
      await GroupMessage.deleteGroupMessage(groupId, timestamp, socket.userId);
      io.to(`group_${groupId}`).emit('groupMessageDeleted', { groupId, timestamp, senderId: socket.userId });
    } catch (error) {
      console.error('Lỗi khi xóa tin nhắn nhóm qua Socket:', error);
      socket.emit('error', error.message || 'Không thể xóa tin nhắn.');
    }
  });

  socket.on('recallGroupMessage', async (data) => {
    const { messageId, senderId } = data;
    if (!messageId || !senderId) {
      socket.emit('error', { message: 'Thiếu messageId hoặc senderId' });
      return;
    }

    if (senderId !== socket.userId) {
      socket.emit('error', { message: 'Không có quyền thu hồi tin nhắn này' });
      console.error('Sender ID mismatch:', { senderId, userId: socket.userId });
      return;
    }

    try {
      const recalledMessage = await GroupMessage.recallGroupMessage(messageId, senderId);
      io.to(`group_${recalledMessage.groupId}`).emit('groupMessageRecalled', recalledMessage);
      socket.emit('groupMessageRecalled', recalledMessage);
    } catch (error) {
      console.error('Lỗi khi thu hồi tin nhắn nhóm qua Socket:', error);
      socket.emit('error', { message: error.message || 'Không thể thu hồi tin nhắn.' });
    }
  });

  socket.on('group:join', async (data) => {
    const { groupId, userEmail, addedBy } = data;
    console.log('Received group:join:', { groupId, userEmail, addedBy });

    try {
      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Nhóm không tồn tại.' });
        return;
      }

      const requester = group.members.find((member) => member.userId === addedBy);
      if (!requester || !['admin', 'co-admin'].includes(requester.role)) {
        socket.emit('error', { message: 'Bạn không có quyền thêm thành viên.' });
        return;
      }

      const user = await User.getUserByEmail(userEmail);
      if (!user) {
        socket.emit('error', { message: 'Không tìm thấy người dùng với email này.' });
        return;
      }

      if (group.members.some((member) => member.userId === user.userId)) {
        socket.emit('error', { message: 'Người dùng đã là thành viên của nhóm.' });
        return;
      }

      const newMember = {
        userId: user.userId,
        username: user.username || user.email,
        role: 'member',
        joinedAt: new Date().toISOString(),
      };
      group.members.push(newMember);

      await Group.updateGroup(groupId, { members: group.members });

      socket.emit('group:joinSuccess', {
        message: `Đã thêm ${user.email} vào nhóm.`,
        groupId,
      });

      io.to(`group_${groupId}`).emit(`groupMemberUpdated_${groupId}`, {
        type: 'member_added',
        userId: user.userId,
        userEmail: user.email,
        group: {
          groupId,
          name: group.name,
          members: group.members,
          ownerId: group.ownerId,
          createdAt: group.createdAt,
        },
      });

      io.to(user.userId).emit(`addedToGroup_${user.userId}`, {
        groupId,
        groupName: group.name,
      });

      console.log(`User ${user.email} added to group ${groupId}`);
    } catch (err) {
      console.error('Error in group:join:', err);
      socket.emit('error', { message: err.message || 'Không thể thêm thành viên.' });
    }
  });

  socket.on('group:leave', async (data) => {
    const { groupId, userId: leaveUserId } = data;

    try {
      const user = await User.getUserById(leaveUserId);
      if (!user) {
        socket.emit('error', { message: 'Không tìm thấy người dùng' });
        return;
      }

      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Không tìm thấy nhóm' });
        return;
      }

      const isMember = group.members.some(member => member.userId === leaveUserId);
      if (!isMember) {
        socket.emit('error', { message: 'Người dùng không ở trong nhóm' });
        return;
      }

      if (group.ownerId === leaveUserId) {
        const coAdmins = group.members.filter(m => m.role === 'co-admin');
        let updatedGroup;

        if (coAdmins.length > 0) {
          const newOwner = coAdmins[0];
          await Group.updateMemberRole(groupId, newOwner.userId, 'admin');
          await Group.updateGroup(groupId, { ownerId: newOwner.userId });
          await Group.removeMember(groupId, leaveUserId);
          updatedGroup = await Group.getGroupById(groupId);

          io.to(newOwner.userId).emit(`groupOwnerChanged_${newOwner.userId}`, {
            groupId,
            groupName: group.name,
          });
          group.members.forEach((member) => {
            if (member.userId !== leaveUserId) {
              io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, {
                type: 'owner_changed',
                userId: newOwner.userId,
                userEmail: (User.getUserById(newOwner.userId))?.email || '',
                group: updatedGroup,
              });
            }
          });
          io.to(leaveUserId).emit(`removedFromGroup_${leaveUserId}`, {
            groupId,
            groupName: group.name,
          });
        } else {
          const otherMembers = group.members.filter(m => m.userId !== leaveUserId);
          if (otherMembers.length > 0) {
            const randomIndex = Math.floor(Math.random() * otherMembers.length);
            const newOwner = otherMembers[randomIndex];
            await Group.updateMemberRole(groupId, newOwner.userId, 'admin');
            await Group.updateGroup(groupId, { ownerId: newOwner.userId });
            await Group.removeMember(groupId, leaveUserId);
            updatedGroup = await Group.getGroupById(groupId);

            io.to(newOwner.userId).emit(`groupOwnerChanged_${newOwner.userId}`, {
              groupId,
              groupName: group.name,
            });
            group.members.forEach((member) => {
              if (member.userId !== leaveUserId) {
                io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, {
                  type: 'owner_changed',
                  userId: newOwner.userId,
                  userEmail: (User.getUserById(newOwner.userId))?.email || '',
                  group: updatedGroup,
                });
              }
            });
            io.to(leaveUserId).emit(`removedFromGroup_${leaveUserId}`, {
              groupId,
              groupName: group.name,
            });
          } else {
            await Group.disbandGroup(groupId);
            group.members.forEach((member) => {
              io.to(member.userId).emit(`groupDisbanded_${member.userId}`, {
                groupId,
                groupName: group.name,
              });
            });
            console.log(`Group ${groupId} disbanded by owner ${leaveUserId}`);
          }
        }
      } else {
        await Group.removeMember(groupId, leaveUserId);
        const updatedGroup = await Group.getGroupById(groupId);

        io.to(leaveUserId).emit(`removedFromGroup_${leaveUserId}`, {
          groupId,
          groupName: group.name,
        });
        group.members.forEach((member) => {
          if (member.userId !== leaveUserId) {
            io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, {
              type: 'member_removed',
              userId: leaveUserId,
              userEmail: user.email,
              group: updatedGroup,
            });
          }
        });
        console.log(`User ${leaveUserId} left group ${groupId}`);
      }

      socket.emit('group:leaveSuccess', { message: 'Rời nhóm thành công', groupId });
    } catch (error) {
      console.error('Error leaving group:', error);
      socket.emit('error', { message: 'Lỗi rời nhóm: ' + error.message });
    }
  });

  socket.on('removeMember', async (data) => {
    const { groupId, userId, memberIdToRemove } = data;

    console.log(`Processing removeMember: user ${userId} removing ${memberIdToRemove} from group ${groupId}`);

    try {
      if (userId === memberIdToRemove) {
        console.error(`User ${userId} cannot remove themselves via removeMember`);
        socket.emit('error', { message: 'Không thể tự xóa chính mình. Sử dụng group:leave để rời nhóm.' });
        return;
      }
      const group = await Group.getGroupById(groupId);
      if (!group) {
        console.error(`Group ${groupId} not found`);
        socket.emit('error', { message: 'Không tìm thấy nhóm' });
        return;
      }

      const requester = group.members.find(m => m.userId === userId);
      if (!requester || (!['admin', 'co-admin'].includes(requester.role) && group.ownerId !== userId)) {
        console.error(`User ${userId} does not have permission to remove members from group ${groupId}`);
        socket.emit('error', { message: 'Chỉ trưởng nhóm hoặc phó nhóm mới có quyền xóa thành viên' });
        return;
      }

      if (memberIdToRemove === group.ownerId) {
        console.error(`Cannot remove group owner ${memberIdToRemove} from group ${groupId}`);
        socket.emit('error', { message: 'Không thể xóa trưởng nhóm' });
        return;
      }

      const memberToRemove = await User.getUserById(memberIdToRemove);
      if (!memberToRemove) {
        console.error(`User ${memberIdToRemove} not found`);
        socket.emit('error', { message: 'Không tìm thấy thành viên để xóa' });
        return;
      }

      console.log(`Removing member ${memberIdToRemove} from group ${groupId}`);
      await Group.removeMember(groupId, memberIdToRemove);
      const updatedGroup = await Group.getGroupById(groupId);

      if (!updatedGroup) {
        console.error(`Failed to fetch updated group ${groupId} after member removal`);
        socket.emit('error', { message: 'Lỗi khi cập nhật nhóm' });
        return;
      }

      io.to(memberIdToRemove).emit(`removedFromGroup_${memberIdToRemove}`, {
        groupId,
        groupName: group.name,
      });

      group.members.forEach((member) => {
        if (member.userId !== memberIdToRemove) {
          io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, {
            type: 'member_removed',
            userId: memberIdToRemove,
            userEmail: memberToRemove.email || 'unknown',
            group: {
              groupId: updatedGroup.groupId,
              name: updatedGroup.name,
              members: updatedGroup.members,
              ownerId: updatedGroup.ownerId,
              createdAt: updatedGroup.createdAt,
            },
          });
        }
      });

      socket.emit('memberRemoved', { message: 'Đã xóa thành viên thành công', userId: memberIdToRemove });
    } catch (error) {
      console.error('Lỗi xóa thành viên:', error);
      socket.emit('error', { message: 'Lỗi xóa thành viên: ' + error.message });
    }
  });

  socket.on('group:disband', async (data) => {
    const { groupId, userId } = data;

    try {
      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Không tìm thấy nhóm' });
        return;
      }

      if (group.ownerId !== userId) {
        socket.emit('error', { message: 'Bạn không có quyền giải tán nhóm' });
        return;
      }

      await Group.disbandGroup(groupId);

      group.members.forEach((member) => {
        io.to(member.userId).emit(`groupDisbanded_${member.userId}`, {
          groupId,
          groupName: group.name,
        });
      });

      socket.emit('group:disbandSuccess', {
        message: 'Nhóm đã được giải tán thành công.',
        groupId,
      });

      console.log(`Group ${groupId} disbanded by user ${userId}`);
    } catch (error) {
      console.error('Error disbanding group:', error);
      socket.emit('error', { message: 'Lỗi giải tán nhóm: ' + error.message });
    }
  });

  socket.on('createGroup', async (data) => {
    const { name, memberIds, avatarUrl } = data;

    if (!name || !memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc: tên nhóm, danh sách thành viên' });
      console.error('Invalid group creation data:', data);
      return;
    }

    const creatorId = socket.userId;
    if (!memberIds.includes(creatorId)) {
      memberIds.push(creatorId);
    }

    try {
      const validMembers = await Promise.all(
        memberIds.map(async (id) => {
          const user = await User.getUserById(id);
          if (!user) {
            throw new Error(`Không tìm thấy người dùng với userId: ${id}`);
          }
          return {
            userId: id,
            username: user.username || user.email || `User_${id}`,
            role: id === creatorId ? 'admin' : 'member',
          };
        })
      );

      const groupData = {
        groupId: `${creatorId}#${Date.now()}`,
        name,
        ownerId: creatorId,
        members: validMembers,
        avatarUrl: avatarUrl || null,
        createdAt: new Date().toISOString(),
      };

      const createdGroup = await Group.createGroup(groupData);
      console.log(`Nhóm ${createdGroup.groupId} được tạo bởi ${creatorId}`);

      memberIds.forEach((memberId) => {
        io.to(memberId).emit(`newGroup_${memberId}`, {
          groupId: createdGroup.groupId,
          name: createdGroup.name,
          ownerId: createdGroup.ownerId,
          members: createdGroup.members,
          avatarUrl: createdGroup.avatarUrl,
          createdAt: createdGroup.createdAt,
          lastMessage: null,
          unreadCount: 0,
        });
        console.log(`Phát sự kiện newGroup_${memberId} tới ${memberId}`);
      });

      socket.emit('groupCreated', { message: 'Nhóm đã được tạo thành công', groupId: createdGroup.groupId });
    } catch (error) {
      console.error('Lỗi tạo nhóm:', error);
      socket.emit('error', { message: 'Lỗi tạo nhóm: ' + error.message });
    }
  });

  socket.on('recallMessage', async (data) => {
    console.log('Received recallMessage:', data);
    const { conversationId, timestamp, senderId } = data;

    if (!conversationId || !timestamp || !senderId) {
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc: conversationId, timestamp, senderId' });
      console.error('Invalid recall data:', data);
      return;
    }

    if (senderId !== socket.userId) {
      socket.emit('error', { message: 'Không có quyền thu hồi tin nhắn này' });
      console.error('Sender ID mismatch:', { senderId, userId: socket.userId });
      return;
    }

    try {
      const updatedMessage = await Message.recallMessage(conversationId, timestamp, senderId);

      if (!updatedMessage || (typeof updatedMessage === 'object' && updatedMessage.message === 'Tin nhắn này đã được thu hồi trước đó.')) {
        socket.emit('error', { message: 'Không tìm thấy tin nhắn hoặc tin nhắn đã được thu hồi trước đó' });
        console.error('Message not recallable:', { conversationId, timestamp });
        return;
      }

      const eventData = {
        conversationId: updatedMessage.conversationId,
        timestamp: updatedMessage.timestamp,
        isRecalled: updatedMessage.isRecalled,
        content: updatedMessage.content || 'Tin nhắn đã được thu hồi.',
        fileUrl: updatedMessage.fileUrl,
        type: updatedMessage.type || 'text',
      };

      socket.to(updatedMessage.receiverId).emit(`messageRecalled_${updatedMessage.receiverId}`, eventData);
      socket.emit(`messageRecalled_${senderId}`, eventData);
      console.log(`Emitted messageRecalled to ${updatedMessage.receiverId} and ${senderId}`);
    } catch (error) {
      console.error('Lỗi thu hồi tin nhắn:', error);
      socket.emit('error', { message: 'Lỗi thu hồi tin nhắn: ' + error.message });
    }
  });

  socket.on('forwardMessage', async (data) => {
    console.log('Received forwardMessage:', data);
    const { messageId, senderId, targetId, targetType, content, type, fileUrl, timestamp, isForwarded, originalSenderId } = data;

    if (!messageId || !senderId || !targetId || !targetType) {
      console.error('Missing required fields:', { messageId, senderId, targetId, targetType });
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc để chuyển tiếp tin nhắn.' });
      return;
    }

    if (senderId !== socket.userId) {
      console.error('Sender ID mismatch:', { senderId, userId: socket.userId });
      socket.emit('error', { message: 'Không có quyền chuyển tiếp tin nhắn.' });
      return;
    }

    try {
      const message = {
        messageId,
        senderId,
        content: content || null,
        type,
        fileUrl: fileUrl || null,
        timestamp: timestamp || new Date().toISOString(),
        isForwarded: isForwarded || true,
        originalSenderId: originalSenderId || senderId,
      };

      if (targetType === 'group') {
        const group = await Group.getGroupById(targetId);
        if (!group || !group.members.some((member) => member.userId === senderId)) {
          console.error('Not a group member:', { targetId, senderId });
          socket.emit('error', { message: 'Bạn không phải thành viên của nhóm đích.' });
          return;
        }
        message.groupId = targetId;
        const savedMessage = await GroupMessage.createGroupMessage(message);
        io.to(`group_${targetId}`).emit('receiveGroupMessage', savedMessage);
      } else if (targetType === 'user') {
        if (targetId === senderId) {
          console.error('Cannot forward to self:', { targetId, senderId });
          socket.emit('error', { message: 'Không thể chuyển tiếp tin nhắn cho chính mình.' });
          return;
        }
        const targetUser = await User.getUserById(targetId);
        if (!targetUser) {
          console.error('Target user not found:', { targetId });
          socket.emit('error', { message: 'Người nhận không tồn tại.' });
          return;
        }
        const sortedIds = [senderId, targetId].sort();
        message.conversationId = `${sortedIds[0]}#${sortedIds[1]}`;
        message.receiverId = targetId;
        const savedMessage = await Message.createMessage(message);
        io.to(targetId).emit(`receiveMessage_${targetId}`, savedMessage);
        io.to(senderId).emit(`receiveMessage_${senderId}`, savedMessage);
      }

      socket.emit('forwardMessageSuccess', { message: 'Tin nhắn đã được chuyển tiếp thành công.', data: message });
    } catch (error) {
      console.error('Forward message error:', error);
      socket.emit('error', { message: 'Không thể chuyển tiếp tin nhắn: ' + error.message });
    }
  });

  socket.on('forwardGroupMessage', async (data) => {
    console.log('Received forwardGroupMessage:', data);
    const { messageId, senderId, targetId, targetType, content, type, fileUrl, timestamp, isForwarded, originalSenderId } = data;

    if (!messageId || !senderId || !targetId || !targetType) {
      socket.emit('error', { message: 'Thiếu thông tin bắt buộc để chuyển tiếp tin nhắn.' });
      console.error('Invalid forward data:', data);
      return;
    }

    if (senderId !== socket.userId) {
      socket.emit('error', { message: 'Không có quyền chuyển tiếp tin nhắn.' });
      console.error('Sender ID mismatch:', { senderId, userId: socket.userId });
      return;
    }

    try {
      const message = {
        messageId: `${targetId}#${senderId}#${Date.now()}`,
        senderId,
        content: content || null,
        type,
        fileUrl: fileUrl || null,
        timestamp: timestamp || new Date().toISOString(),
        isForwarded: isForwarded || true,
        originalSenderId: originalSenderId || senderId,
      };

      if (targetType === 'group') {
        const group = await Group.getGroupById(targetId);
        if (!group || !group.members.some((member) => member.userId === senderId)) {
          socket.emit('error', { message: 'Bạn không phải thành viên của nhóm đích.' });
          return;
        }
        message.groupId = targetId;
        const savedMessage = await GroupMessage.createGroupMessage(message);
        console.log('Emitting receiveGroupMessage to group_', targetId, ':', savedMessage);
        io.to(`group_${targetId}`).emit('receiveGroupMessage', savedMessage);
      } else if (targetType === 'user') {
        if (targetId === senderId) {
          socket.emit('error', { message: 'Không thể chuyển tiếp tin nhắn cho chính mình.' });
          return;
        }
        const targetUser = await User.getUserById(targetId);
        if (!targetUser) {
          socket.emit('error', { message: 'Người nhận không tồn tại.' });
          return;
        }
        const sortedIds = [senderId, targetId].sort();
        message.conversationId = `${sortedIds[0]}#${sortedIds[1]}`;
        message.receiverId = targetId;
        const savedMessage = await Message.createMessage(message);
        console.log('Emitting receiveMessage to', targetId, ':', savedMessage);
        io.to(targetId).emit(`receiveMessage_${targetId}`, savedMessage);
        io.to(senderId).emit(`receiveMessage_${senderId}`, savedMessage);
      }

      socket.emit('forwardMessageSuccess', { message: 'Tin nhắn đã được chuyển tiếp thành công.', data: message });
    } catch (error) {
      console.error('Lỗi khi chuyển tiếp tin nhắn:', error);
      socket.emit('error', { message: 'Không thể chuyển tiếp tin nhắn: ' + error.message });
    }
  });

  socket.on('assignCoAdmin', async (data) => {
    const { groupId, userId, newAdminId } = data;

    try {
      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Không tìm thấy nhóm' });
        return;
      }

      if (group.ownerId !== userId) {
        socket.emit('error', { message: 'Chỉ trưởng nhóm mới có quyền gán phó nhóm' });
        return;
      }

      const newAdmin = group.members.find(member => member.userId === newAdminId);
      if (!newAdmin || newAdmin.role === 'admin') {
        socket.emit('error', { message: 'Không thể gán phó nhóm cho thành viên này' });
        return;
      }

      await Group.updateMemberRole(groupId, newAdminId, 'co-admin');

      const updatedGroup = await Group.getGroupById(groupId);
      const updatedMember = updatedGroup.members.find(m => m.userId === newAdminId);

      io.to(`group_${groupId}`).emit(`groupMemberUpdated_${groupId}`, {
        type: 'role_updated',
        userId: newAdminId,
        userEmail: (await User.getUserById(newAdminId))?.email || '',
        group: {
          groupId: updatedGroup.groupId,
          members: updatedGroup.members,
        },
      });

      socket.emit('coAdminAssigned', { message: 'Đã gán phó nhóm thành công', userId: newAdminId });
    } catch (error) {
      console.error('Lỗi gán phó nhóm:', error);
      socket.emit('error', { message: 'Lỗi gán phó nhóm: ' + error.message });
    }
  });

  socket.on('removeMember', async (data) => {
    const { groupId, userId, memberIdToRemove } = data;

    try {
      const group = await Group.getGroupById(groupId);
      if (!group) {
        socket.emit('error', { message: 'Không tìm thấy nhóm' });
        return;
      }

      if (group.ownerId !== userId && !['admin', 'co-admin'].includes(group.members.find(m => m.userId === userId)?.role)) {
        socket.emit('error', { message: 'Chỉ trưởng nhóm hoặc phó nhóm mới có quyền xóa thành viên' });
        return;
      }

      if (memberIdToRemove === group.ownerId) {
        socket.emit('error', { message: 'Không thể xóa trưởng nhóm' });
        return;
      }

      await Group.removeMember(groupId, memberIdToRemove);

      const updatedGroup = await Group.getGroupById(groupId);

      io.to(`group_${groupId}`).emit(`groupMemberUpdated_${groupId}`, {
        type: 'member_removed',
        userId: memberIdToRemove,
        userEmail: (await User.getUserById(memberIdToRemove))?.email || '',
        group: {
          groupId: updatedGroup.groupId,
          members: updatedGroup.members,
        },
      });

      socket.emit('memberRemoved', { message: 'Đã xóa thành viên thành công', userId: memberIdToRemove });
    } catch (error) {
      console.error('Lỗi xóa thành viên:', error);
      socket.emit('error', { message: 'Lỗi xóa thành viên: ' + error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Người dùng ${socket.userId} đã ngắt kết nối với socket ID: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server đang chạy ở port: ${PORT}`);
});