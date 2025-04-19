const FriendModel = require('../models/friend.model'); // Chỉ cần 1 model
const User = require('../models/user.model');
const { v4: uuidv4 } = require('uuid');

// Gửi lời mời kết bạn bằng email
exports.sendFriendRequest = async (req, res) => {
  try {
    const fromEmail = req.user.email; // Giả sử token chứa email
    const { email: toEmail } = req.body;

    const toUser = await User.getUserByEmail(toEmail);
    if (!toUser) return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    if (toUser.email === fromEmail) return res.status(400).json({ message: 'Không thể kết bạn với chính mình' });

    // Kiểm tra yêu cầu hiện có
    const requests = await FriendModel.getRequests(toEmail);
    if (requests.some((req) => req.fromEmail === fromEmail))
      return res.status(400).json({ message: 'Đã gửi lời mời rồi' });

    const request = await FriendModel.sendRequest(fromEmail, toEmail);

    res.json({ message: 'Lời mời đã gửi', requestId: request.requestId });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Chấp nhận lời mời
exports.acceptRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const currentEmail = req.user.email; // Giả sử token chứa email

    const request = await FriendModel.getRequests(currentEmail).then((requests) =>
      requests.find((r) => r.requestId === requestId)
    );
    if (!request)
      return res.status(400).json({ message: 'Không hợp lệ hoặc không có quyền' });

    await FriendModel.acceptRequest(requestId);

    res.json({ message: 'Kết bạn thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Từ chối lời mời
exports.declineRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const currentEmail = req.user.email;

    const request = await FriendModel.getRequests(currentEmail).then((requests) =>
      requests.find((r) => r.requestId === requestId)
    );
    if (!request)
      return res.status(400).json({ message: 'Không hợp lệ hoặc không có quyền' });

    await FriendModel.declineRequest(requestId);

    res.json({ message: 'Đã từ chối lời mời' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Xóa bạn
exports.removeFriend = async (req, res) => {
  try {
    const { email: otherEmail } = req.body;
    const currentEmail = req.user.email;

    const otherUser = await User.getUserByEmail(otherEmail);
    if (!otherUser) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

    await FriendModel.removeFriend(currentEmail, otherUser.email);

    res.json({ message: 'Đã xóa bạn' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};
// Lấy danh sách lời mời kết bạn đang chờ phản hồi
exports.getReceivedRequests = async (req, res) => {
  try {
    const currentEmail = req.user.email;
    const requests = await FriendModel.getRequests(currentEmail);

    // Lấy thông tin người gửi
    const enrichedRequests = await Promise.all(
      requests.map(async (req) => {
        const sender = await User.getUserByEmail(req.fromEmail);
        return {
          requestId: req.requestId,
          fromEmail: req.fromEmail,
          fromUsername: sender?.username || '',
          fromAvatar: sender?.avatarUrl || '',
          status: req.status,
          createdAt: req.createdAt,
        };
      })
    );

    res.json({ message: 'Danh sách lời mời kết bạn nhận được', requests: enrichedRequests });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Lấy danh sách bạn bè 
exports.getFriendList = async (req, res) => {
    try {
      const currentEmail = req.user.email;
      const friends = await FriendModel.getFriends(currentEmail);
  
      res.json({ message: 'Danh sách bạn bè', friends });
    } catch (err) {
      res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
    }
  };

 