require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');

const corsOptions = {
  origin: [
      'http://localhost:3000', // Origin của ứng dụng web (nếu có)
      'http://localhost:8081', // Origin của ứng dụng client (chạy ở port 8081)
      'http://10.0.2.2:5000', // Origin cho Android emulator (nếu cần để test app trên emulator gọi backend localhost)
      'http://localhost:5000', // Có thể cần cho iOS simulator hoặc test cục bộ
      // Thêm các origin khác nếu cần
  ],
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Quan trọng nếu bạn xử lý cookies hoặc authorization headers
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// View Engine for Email Template
app.set('view engine', 'ejs');
app.set('views', './views');

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
