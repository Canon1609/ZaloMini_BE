const User = require('../models/user.model');
const { uploadToS3 } = require('../utils/s3.util');

exports.getProfile = async (req, res) => {
  try {
    const user = await User.getUserById(req.user.userId);
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.getUserById(req.user.userId);
    const valid = await require('bcrypt').compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ message: 'Mật khẩu hiện tại sai' });

    const passwordHash = await require('bcrypt').hash(newPassword, 10);
    await User.updateUser(req.user.userId, { passwordHash });

    res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

exports.updateAvatar = async (req, res) => {
  try {
    const imageUrl = await uploadToS3(req.file);
    await User.updateUser(req.user.userId, { avatarUrl: imageUrl });

    res.json({ message: 'Cập nhật ảnh đại diện thành công', avatarUrl: imageUrl });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};


exports.searchByEmail = async (req, res)=> {
  try {
    const { email } = req.query;

    const user = await User.getUserByEmail(email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ userId: user.userId });
  } catch (err) {
    console.error('searchByEmail error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
