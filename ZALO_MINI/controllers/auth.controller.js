const bcrypt = require('bcrypt');
const { signToken, verifyToken } = require('../utils/jwt.util');
const { sendVerificationEmail, sendResetPasswordEmail ,sendResetPasswordEmailApp,sendVerificationEmailApp} = require('../utils/email.util');
const User = require('../models/user.model');

// Đăng ký
exports.register = async (req, res) => {
  try {
    const origin = req.headers.origin || 'http://localhost:3000'; // Lấy origin từ client, mặc định 3000 nếu không có
    const { email, password, username } = req.body;

    // Kiểm tra email đã tồn tại chưa
    const existingUser = await User.getUserByEmail(email);
    if (existingUser) return res.status(400).json({ message: 'Email đã tồn tại' });

    // Hash mật khẩu
    const passwordHash = await bcrypt.hash(password, 10);

    // Tạo user trong DB
    const newUser = await User.createUser({
      email,
      passwordHash,
      username,
    });

    // Gửi email xác minh
    const token = signToken({ userId: newUser.userId, email });
    await sendVerificationEmail(email, token , origin);

    res.status(201).json({ message: 'Đăng ký thành công. Vui lòng xác minh email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

exports.registerApp = async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Kiểm tra email đã tồn tại chưa
    const existingUser = await User.getUserByEmail(email);
    if (existingUser) return res.status(400).json({ message: 'Email đã tồn tại' });

    // Hash mật khẩu
    const passwordHash = await bcrypt.hash(password, 10);

    // Tạo user trong DB
    const newUser = await User.createUser({
      email,
      passwordHash,
      username,
    });

    // Gửi email xác minh
    const token = signToken({ userId: newUser.userId, email });
    await sendVerificationEmailApp(email, token);

    res.status(201).json({ message: 'Đăng ký thành công. Vui lòng xác minh email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Xác minh email
exports.verifyEmail = async (req, res) => {
  try {
    
    const { token } = req.query;
    const decoded = verifyToken(token);

    const user = await User.getUserById(decoded.userId);
    if (!user) return res.status(404).json({ message: 'Người dùng không tồn tại' });

    // Cập nhật trạng thái đã xác minh
    await User.updateUser(user.userId, { isVerified: true });

    res.status(200).json({ message: 'Xác minh email thành công' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

exports.verifyEmailApp = async (req, res) => {
  try {
    const { token } = req.query;
    const decoded = verifyToken(token);

    const user = await User.getUserById(decoded.userId);
    if (!user) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Lỗi xác minh</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              h1 { color: #ff0000; }
              p { font-size: 18px; }
              a { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #0068FF; color: white; text-decoration: none; border-radius: 5px; }
            </style>
          </head>
          <body>
            <h1>Lỗi xác minh</h1>
            <p>Người dùng không tồn tại.</p>
            <a href="${process.env.EXPO_URL}/--/login">Mở ứng dụng</a>
          </body>
        </html>
      `);
    }

    // Cập nhật cột isVerified
    await User.updateUser(user.userId, { isVerified: true });
    console.log('Updated user:', await User.getUserById(user.userId)); // Debug

    const redirectUrl = `${process.env.EXPO_URL}/--/api/auth/verify-email-app?token=${token}`;
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Xác minh email</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #0068FF; }
            p { font-size: 18px; }
            a { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #0068FF; color: white; text-decoration: none; border-radius: 5px; }
          </style>
          <script>
            window.location.href = "${redirectUrl}";
            setTimeout(() => {
              document.getElementById("fallback-message").style.display = "block";
            }, 1000);
          </script>
        </head>
        <body>
          <h1>Xác minh email thành công!</h1>
          <p>Đang mở ứng dụng...</p>
          <div id="fallback-message" style="display: none;">
            <p>Nếu ứng dụng không mở, bạn có thể nhấp vào nút bên dưới:</p>
            <a href="${redirectUrl}">Mở ứng dụng</a>
            <p>Hoặc quay lại đăng nhập:</p>
            <a href="${process.env.EXPO_URL}/--/login">Đăng nhập</a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Lỗi xác minh</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #ff0000; }
            p { font-size: 18px; }
            a { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #0068FF; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <h1>Lỗi xác minh</h1>
          <p>Token không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.</p>
          <a href="${process.env.EXPO_URL}/--/login">Mở ứng dụng</a>
        </body>
      </html>
    `);
  }
};



// Đăng nhập
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.getUserByEmail(email);
    if (!user) return res.status(400).json({ message: 'Sai email hoặc mật khẩu' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ message: 'Sai email hoặc mật khẩu' });

    if (!user.isVerified) {
      return res.status(401).json({ message: 'Tài khoản chưa xác minh email' });
    }

    const token = signToken({ userId: user.userId, email: user.email });
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Quên mật khẩu
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.getUserByEmail(email);
    if (!user) return res.status(404).json({ message: 'Email không tồn tại' });

    const token = signToken({ userId: user.userId });
    await sendResetPasswordEmail(email, token);

    res.json({ message: 'Email khôi phục mật khẩu đã được gửi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

exports.forgotPasswordApp = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.getUserByEmail(email);
    if (!user) return res.status(404).json({ message: 'Email không tồn tại' });

    const token = signToken({ userId: user.userId });
    await sendResetPasswordEmailApp(email, token);

    res.json({ message: 'Email khôi phục mật khẩu đã được gửi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Đặt lại mật khẩu
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = verifyToken(token);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.updateUser(decoded.userId, { passwordHash });

    res.json({ message: 'Đặt lại mật khẩu thành công' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};
