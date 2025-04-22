const Group = require('../models/group.model');
const User = require('../models/user.model');

exports.createGroup = async (req, res) => {
    try {
        const { name, initialMembersEmails } = req.body;
        const ownerId = req.user.userId;

        if (!name || !initialMembersEmails || !Array.isArray(initialMembersEmails) || initialMembersEmails.length < 1) {
            return res.status(400).json({ message: 'Vui lòng cung cấp tên nhóm và ít nhất một thành viên ban đầu.' });
        }

        const members = [];
        const uniqueEmails = [...new Set(initialMembersEmails)];

        if (!uniqueEmails.includes(req.user.email)) {
            uniqueEmails.unshift(req.user.email);
        }

        const usersToAdd = await Promise.all(
            uniqueEmails.map(async (email) => {
                const user = await User.getUserByEmail(email);
                if (!user) {
                    return { email, error: 'Không tìm thấy người dùng với email này.' };
                }
                return { userId: user.userId, email: user.email };
            })
        );

        const errors = usersToAdd.filter((user) => user.error);
        if (errors.length > 0) {
            return res.status(400).json({ message: 'Lỗi khi thêm thành viên.', errors });
        }

        const groupMembers = usersToAdd.map(user => ({
            userId: user.userId,
            role: user.userId === ownerId ? 'admin' : 'member'
        }));

        const newGroup = {
            name,
            ownerId,
            members: groupMembers
        };

        const createdGroup = await Group.createGroup(newGroup);
        res.status(201).json(createdGroup);

        // Phát sự kiện Socket.IO thông báo nhóm mới (tùy chọn)
        const io = req.app.get('socketio');
        groupMembers.forEach(member => {
            io.to(member.userId).emit(`newGroup_${member.userId}`, createdGroup);
        });

    } catch (error) {
        console.error('Lỗi khi tạo nhóm:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi tạo nhóm.' });
    }
};
exports.getUserGroups = async (req, res) => {
    try {
        const userId = req.user.userId;
        const groups = await Group.getGroupsByUserId(userId);
        res.json(groups);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách nhóm của người dùng:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi lấy danh sách nhóm.' });
    }
};

exports.addMember = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { email } = req.body;
        const requesterId = req.user.userId;
        const io = req.app.get('socketio');

        const group = await Group.getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Không tìm thấy nhóm.' });
        }

        const requesterMember = group.members.find(member => member.userId === requesterId);
        if (!requesterMember || (requesterMember.role !== 'admin' && requesterMember.role !== 'co-admin')) {
            return res.status(403).json({ message: 'Bạn không có quyền thêm thành viên vào nhóm này.' });
        }

        const userToAdd = await User.getUserByEmail(email);
        if (!userToAdd) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng với email này.' });
        }

        if (group.members.some(member => member.userId === userToAdd.userId)) {
            return res.status(400).json({ message: 'Người dùng này đã là thành viên của nhóm.' });
        }

        await Group.addMember(groupId, userToAdd.userId);
        res.json({ message: 'Đã thêm thành viên vào nhóm thành công.' });

        // Phát sự kiện Socket.IO thông báo thành viên mới
        io.to(userToAdd.userId).emit(`addedToGroup_${userToAdd.userId}`, { groupId, groupName: group.name });
        group.members.forEach(member => {
            if (member.userId !== userToAdd.userId) {
                io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, { type: 'member_added', userId: userToAdd.userId, group });
            }
        });

    } catch (error) {
        console.error('Lỗi khi thêm thành viên:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi thêm thành viên.' });
    }
};

exports.removeMember = async (req, res) => {
    try {
        const { groupId, userIdToRemove } = req.params;
        const requesterId = req.user.userId;
        const io = req.app.get('socketio');

        const group = await Group.getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Không tìm thấy nhóm.' });
        }

        const requesterMember = group.members.find(member => member.userId === requesterId);
        if (!requesterMember || (requesterMember.role !== 'admin' && requesterMember.role !== 'co-admin')) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa thành viên khỏi nhóm này.' });
        }

        if (group.ownerId === userIdToRemove && requesterId !== userIdToRemove) {
            return res.status(403).json({ message: 'Bạn không thể xóa trưởng nhóm.' });
        }

        await Group.removeMember(groupId, userIdToRemove);
        res.json({ message: 'Đã xóa thành viên khỏi nhóm thành công.' });

        // Phát sự kiện Socket.IO thông báo thành viên bị xóa
        io.to(userIdToRemove).emit(`removedFromGroup_${userIdToRemove}`, { groupId, groupName: group.name });
        group.members.forEach(member => {
            if (member.userId !== userIdToRemove) {
                io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, { type: 'member_removed', userId: userIdToRemove, group });
            }
        });

    } catch (error) {
        console.error('Lỗi khi xóa thành viên:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi xóa thành viên.' });
    }
};

exports.disbandGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const requesterId = req.user.userId;
        const io = req.app.get('socketio');

        const group = await Group.getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Không tìm thấy nhóm.' });
        }

        if (group.ownerId !== requesterId) {
            return res.status(403).json({ message: 'Bạn không có quyền giải tán nhóm này.' });
        }

        await Group.disbandGroup(groupId);
        res.json({ message: 'Đã giải tán nhóm thành công.' });

        // Phát sự kiện Socket.IO thông báo nhóm bị giải tán
        group.members.forEach(member => {
            io.to(member.userId).emit(`groupDisbanded_${member.userId}`, { groupId, groupName: group.name });
        });

    } catch (error) {
        console.error('Lỗi khi giải tán nhóm:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi giải tán nhóm.' });
    }
};

exports.assignAdmin = async (req, res) => {
    try {
        const { groupId, userIdToAssign } = req.params;
        const requesterId = req.user.userId;
        const io = req.app.get('socketio');

        const group = await Group.getGroupById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Không tìm thấy nhóm.' });
        }

        if (group.ownerId !== requesterId) {
            return res.status(403).json({ message: 'Chỉ trưởng nhóm mới có quyền gán quyền quản trị.' });
        }

        const memberToAssign = group.members.find(member => member.userId === userIdToAssign);
        if (!memberToAssign) {
            return res.status(404).json({ message: 'Người dùng không phải là thành viên của nhóm.' });
        }

        await Group.updateMemberRole(groupId, userIdToAssign, 'co-admin');
        res.json({ message: 'Đã gán quyền quản trị thành công.' });

        // Phát sự kiện Socket.IO thông báo có phó nhóm mới
        io.to(userIdToAssign).emit(`groupRoleUpdated_${userIdToAssign}`, { groupId, groupName: group.name, role: 'co-admin' });
        group.members.forEach(member => {
            if (member.userId !== userIdToAssign) {
                io.to(member.userId).emit(`groupMemberUpdated_${groupId}`, { type: 'role_updated', userId: userIdToAssign, role: 'co-admin', group });
            }
        });

    } catch (error) {
        console.error('Lỗi khi gán quyền quản trị:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra khi gán quyền quản trị.' });
    }
};