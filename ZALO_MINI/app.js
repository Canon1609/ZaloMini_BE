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
app.set('views', './views');
app.set('socketio', io);
// Socket.IO cho chat thời gian thực
io.on('connection', (socket) => {
  console.log('Người dùng đã kết nối:', socket.id);
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
  
  socket.on('disconnect', () => {
    console.log('Người dùng ngắt kết nối:', socket.id);
  });
});
const PORT = process.env.PORT || 5000;

// Khởi động server với Socket.IO
server.listen(PORT, () => {
  console.log(`Server đang chạy ở port :  ${PORT}`);
});