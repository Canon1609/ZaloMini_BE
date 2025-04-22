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

  // Gửi tin nhắn
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
      // Lưu tin nhắn vào DynamoDB bằng Message.createMessage
      const message = await Message.createMessage({
        senderId,
        receiverId,
        content: content || null,
        type : messageType,
        fileUrl: fileUrl || null,
        isRead: false,
        conversationId: [senderId, receiverId].sort().join('#'),
        timestamp: new Date().toISOString(),
      });
      console.log(`Gửi tin nhắn tới receiverId: ${receiverId}`);
      // Gửi tin nhắn tới receiver qua room
      io.to(receiverId).emit(`receiveMessage_${receiverId}`, message);
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




  socket.on('disconnect', () => {
    console.log('Người dùng ngắt kết nối:', socket.id);
  });
});
const PORT = process.env.PORT || 5000;

// Khởi động server với Socket.IO
server.listen(PORT, () => {
  console.log(`Server đang chạy ở port :  ${PORT}`);
});