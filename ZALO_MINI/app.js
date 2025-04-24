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
const User = require('./models/user.model'); // Thêm import User
const FriendModel = require('./models/friend.model');
const friendRoutes = require('./routes/friend.routes');
const groupRoutes = require('./routes/group.routes');
const groupChatRoutes = require('./routes/groupChat.routes');
const GroupMessage = require('./models/groupMessage.model'); // Import model GroupMessage

// Cấu hình CORS chung cho cả Express và Socket.IO
const corsOptions = {
    origin: [
        'http://localhost:3000', // Create React App
        'http://localhost:3001',
        'http://localhost:5173', // Vite
        'http://localhost:8081',
        'http://10.0.2.2:5000', // Android emulator
        'http://localhost:5000', // iOS simulator hoặc test cục bộ
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
};

// Khởi tạo Socket.IO với server HTTP cho phép các kết nối WebSocket
const io = new Server(server, {
    cors: {
        origin: corsOptions.origin, // Đồng bộ với corsOptions
        methods: ['GET', 'POST'],
        credentials: true, // Cho phép gửi token qua auth
        pingTimeout: 60000, // Tăng timeout lên 60 giây (mặc định là 20 giây)
        pingInterval: 25000, // Gửi ping mỗi 25 giây (mặc định là 25 giây)
    },
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
// API cho cuộc trò chuyện
app.use("/api/chat", chatRoutes);
//API cho friend
app.use('/api/friend', friendRoutes);
// API cho nhóm
app.use('/api/groups', groupRoutes);
app.use('/api/group-chat', groupChatRoutes);
app.set('views', './views');
app.set('socketio', io);
// Socket.IO cho chat thời gian thực
io.on('connection', (socket) => {

    // Xác thực token từ client
    if (!socket.handshake.auth || !socket.handshake.auth.token) {
        console.log('Không có token được cung cấp, đang ngắt kết nối:', socket.id);
        socket.disconnect();
        return;
    }
    // Lấy token từ socket handshake
    const token = socket.handshake.auth.token;
    let userId;
    try {
        // Giải mã token để lấy userId
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
        socket.join(userId); // Tham gia room với userId
        console.log(`Người dùng ${userId} đã tham gia room`);
    } catch (err) {
        console.log('Token không hợp lệ, đang ngắt kết nối:', socket.id);
        socket.disconnect();
        return;
    }

    // GỬI TIN NHẮN
    socket.on('sendMessage', async (data) => {
        const { senderId, receiverId, content, type, fileUrl } = data;
        // Kiểm tra dữ liệu đầu vào
        if (!senderId || !receiverId || (!content && !fileUrl) || !type) {
            socket.emit('error', { message: 'Thiếu thông tin bắt buộc để gửi tin nhắn' });
            return;
        }
        // Kiểm tra senderId có khớp với userId từ token không
        if (senderId !== userId) {
            socket.emit('error', { message: 'Không có quyền gửi tin nhắn từ người dùng này' });
            return;
        }

        try {
            // Xác định type nếu là file
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
            // tạo message
            const message = {
                messageId: `${senderId}#${receiverId}#${Date.now()}`,
                senderId,
                receiverId,
                content: content || null,
                type: fileUrl ? messageType : type,
                fileUrl: fileUrl ? fileUrl : null,
                isRead: false,
                conversationId: [senderId, receiverId].sort().join('#'),
                timestamp: new Date().toISOString(),
            };

            // Gửi tin nhắn tới receiver
            io.to(`user_${receiverId}`).emit(`receiveMessage_${message.receiverId}`, {
                messageId: message.messageId,
                senderId,
                receiverId,
                content: content || null,
                type: messageType,
                fileUrl: fileUrl || null,
                isRead: false,
                conversationId: [senderId, receiverId].sort().join('#'),
                timestamp: message.timestamp,
            });
        } catch (error) {
            console.error('Lỗi lưu tin nhắn:', error);
            socket.emit('error', { message: 'Lỗi lưu tin nhắn, vui lòng thử lại' });
        }
    });

    // THÊM MỚI: Gửi lời mời kết bạn
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

            const requests = await FriendModel.getRequests(receiver.email);
            if (requests.some((req) => req.fromEmail === sender.email)) {
                socket.emit('error', { message: 'Đã gửi lời mời rồi' });
                return;
            }

            const request = await FriendModel.sendRequest(sender.email, receiver.email);
            console.log('--- EMITTING receiveFriendRequest ---');
            console.log('receiver.userId:', receiver.userId, typeof receiver.userId); // Thêm log này

            // Phát sự kiện 'receiveFriendRequest' đến người nhận
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

    // THÊM MỚI: Chấp nhận lời mời kết bạn
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

    // THÊM MỚI: Từ chối lời mời kết bạn
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

    // THÊM MỚI: Xóa bạn bè
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
        console.log(`Người dùng ${userId} đã tham gia nhóm ${groupId}`);
    });

    socket.on('leaveGroup', (groupId) => {
        socket.leave(`group_${groupId}`);
        console.log(`Người dùng ${userId} đã rời nhóm ${groupId}`);
    });

    socket.on('sendGroupMessage', async (data) => {
        const { groupId, content, type, fileUrl } = data;
        if (!groupId || (!content && !fileUrl) || !type) {
          socket.emit('error', { message: 'Thiếu thông tin bắt buộc để gửi tin nhắn' });
          return;
        }
    
        if (userId !== socket.handshake.auth.userId) {
          socket.emit('error', { message: 'Không có quyền gửi tin nhắn từ người dùng này' });
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
    
        // Tạo messageId theo format của DynamoDB
        const messageId = `${groupId}#${userId}#${Date.now()}`;
    
        const message = {
          messageId, // Sử dụng messageId đã tạo
          senderId: userId,
          content: content || null,
          type: fileUrl ? messageType : type,
          fileUrl: fileUrl || null,
          isRecalled: false, // Thêm trường isRecalled
          timestamp: new Date().toISOString(),
          groupId: groupId, // Đảm bảo groupId được truyền
        };
    
        try {
          const savedMessage = await GroupMessage.createGroupMessage(message);
          io.to(`group_${groupId}`).emit('receiveGroupMessage', savedMessage);
        } catch (error) {
          console.error('Lỗi khi gửi tin nhắn nhóm qua Socket:', error);
          socket.emit('error', 'Không thể gửi tin nhắn.');
        }
      });

    socket.on('deleteGroupMessage', async (data) => {
        const { groupId, timestamp } = data;
        if (!groupId || !timestamp) return;

        try {
            await GroupMessage.deleteGroupMessage(groupId, timestamp, userId);
            io.to(`group_${groupId}`).emit('groupMessageDeleted', { groupId, timestamp, senderId: userId });
        } catch (error) {
            console.error('Lỗi khi xóa tin nhắn nhóm qua Socket:', error);
            socket.emit('error', error.message || 'Không thể xóa tin nhắn.');
        }
    });

    socket.on('recallGroupMessage', async (data) => {
        const { groupId, timestamp } = data;
        if (!groupId || !timestamp) return;

        try {
            const recalledMessage = await GroupMessage.recallGroupMessage(groupId, timestamp, userId);
            io.to(`group_${groupId}`).emit('groupMessageRecalled', recalledMessage);
        } catch (error) {
            console.error('Lỗi khi thu hồi tin nhắn nhóm qua Socket:', error);
            socket.emit('error', error.message || 'Không thể thu hồi tin nhắn.');
        }
    });

    // Thêm các sự kiện liên quan đến nhóm (thêm thành viên, rời nhóm, v.v.)
    socket.on('group:join', async (data) => {
        const { groupId, userId } = data;

        // Kiểm tra xem người dùng có tồn tại không
        const user = await User.getUserById(userId);
        if (!user) {
            socket.emit('error', { message: 'Không tìm thấy người dùng' });
            return;
        }

        // Kiểm tra xem nhóm có tồn tại không (bạn có thể cần một model Group)
        // Giả sử bạn có một hàm Group.getGroupById(groupId)
        const group = await Group.getGroupById(groupId); // Thay thế bằng hàm thực tế của bạn
        if (!group) {
            socket.emit('error', { message: 'Không tìm thấy nhóm' });
            return;
        }

        // Kiểm tra xem người dùng đã ở trong nhóm chưa
        const isMember = group.members.some(member => member.userId === userId); // Adjust the condition based on your Group model
        if (isMember) {
            socket.emit('error', { message: 'Người dùng đã ở trong nhóm' });
            return;
        }

        // Logic để thêm người dùng vào nhóm (sử dụng model Group của bạn)
        await Group.addMember(groupId, userId); // Thay thế bằng hàm thực tế của bạn

        // Phát sự kiện thông báo cho các thành viên khác trong nhóm
        io.to(`group_${groupId}`).emit('group:memberJoined', { userId, groupId, username: user.username });
    });

    socket.on('group:leave', async (data) => {
        const { groupId, userId } = data;

        // Kiểm tra xem người dùng có tồn tại không
        const user = await User.getUserById(userId);
        if (!user) {
            socket.emit('error', { message: 'Không tìm thấy người dùng' });
            return;
        }

        // Kiểm tra xem nhóm có tồn tại không
        const group = await Group.getGroupById(groupId);  // Thay thế bằng hàm thực tế của bạn
        if (!group) {
            socket.emit('error', { message: 'Không tìm thấy nhóm' });
            return;
        }

        const isMember = group.members.some(member => member.userId === userId);  // Adjust the condition
        if (!isMember) {
            socket.emit('error', { message: 'Người dùng không ở trong nhóm' });
            return;
        }

        // Logic để xóa người dùng khỏi nhóm
        await Group.removeMember(groupId, userId);  // Thay thế bằng hàm thực tế của bạn

        // Phát sự kiện thông báo cho các thành viên còn lại trong nhóm
        io.to(`group_${groupId}`).emit('group:memberLeft', { userId, groupId, username: user.username });
    });

    socket.on('group:disband', async (data) => {
        const { groupId, userId } = data;

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

        io.to(`group_${groupId}`).emit('group:disbanded', { groupId });
    });

    socket.on('group:assignAdmin', async (data) => {
        const { groupId, userId, newAdminId } = data;

        const group = await Group.getGroupById(groupId);
        if (!group) {
            socket.emit('error', { message: 'Không tìm thấy nhóm' });
            return;
        }

        if (group.ownerId !== userId) {
            socket.emit('error', { message: 'Chỉ trưởng nhóm mới có quyền chỉ định admin' });
            return;
        }

        const newAdmin = group.members.find(member => member.userId === newAdminId);
        if (!newAdmin) {
            socket.emit('error', { message: 'Không tìm thấy thành viên để chỉ định làm admin' });
            return;
        }

        await Group.updateMemberRole(groupId, newAdminId, 'co-admin');

        io.to(`group_${groupId}`).emit('group:adminAssigned', { groupId, userId: newAdminId });
    });

    socket.on('disconnect', () => {
        console.log('Người dùng ngắt kết nối:', socket.id);
    });
});
const PORT = process.env.PORT || 5000;

// Khởi động server với Socket.IO
server.listen(PORT, () => {
    console.log(`Server đang chạy ở port :  ${PORT}`);
});
