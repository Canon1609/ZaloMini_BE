# ZaloMini_BE
Chức năng	            Method	    Endpoint						                    Mô tả
-----------------------------------------------------------------------------------------------------------------------------
Đăng ký		            POST	      http://localhost:5000/api/auth/register			Nhập email, password, username → lưu DynamoDB   
{
  "email": "ldj05587@jioso.com",
  "password": "123456",
  "username": "User One"
}
-------------------------------------------------------------------------------------------------------------------------------
Xác minh	            GET	      http://localhost:5000/api/auth/verify-email?token=(đã gửi trong email xác minh)
-------------------------------------------------------------------------------------------------------------------------------
Đăng nhập	POST	http://localhost:5000/api/auth/login			Trả về JWT nếu đúng email + password         	
{
  "email": "user1@gmail.com",
  "password": "123456"
}
--đăng nhập xong lưu token để test các chức năng bên dưới
-------------------------------------------------------------------------------------------------------------------------------
Xem profile	GET	http://localhost:5000/api/user/profile			Lấy info người dùng từ JWT
Authorization:
Chọn tab Authorization.
Chọn Type là Bearer Token.
Nhập JWT hợp lệ vào trường Token. (token lấy từ đăng nhập sau khi đăng nhập thành công)
Body: Không cần body.
-------------------------------------------------------------------------------------------------------------------------------
Đổi mật khẩu	POST	http://localhost:5000/api/user/update-password
Thêm Authorization (JWT):
Chuyển đến tab "Authorization".
Chọn "Bearer Token" từ dropdown "Type".
Nhập JWT hợp lệ vào trường Token. (token lấy từ đăng nhập sau khi đăng nhập thành công)	
{
    "currentPassword": "mật_khẩu_hiện_tại_của_bạn",
    "newPassword": "mật_khẩu_mới_bạn_muốn_đặt"
}	
-------------------------------------------------------------------------------------------------------------------------------
Cập nhật avatar	 PUT	http://localhost:5000/api/user/update-avatar		Upload ảnh lên S3 và cập nhật link trong DynamoDB
Thêm Authorization (JWT):
Chuyển đến tab "Authorization".
Chọn "Bearer Token" từ dropdown "Type".
Nhập JWT hợp lệ vào trường Token. (token lấy từ đăng nhập sau khi đăng nhập thành công)	
Cấu hình Body (form-data):

Chuyển đến tab "Body".
Chọn "form-data".
Thêm một key (trường) với tên chính xác là avatar (phải trùng với tên bạn đã cấu hình trong middleware upload.single('avatar') ở file user.routes.js).
Ở cột "Value" của key avatar, chọn kiểu là "File".
Nhấp vào nút "Select File" (hoặc tương tự) và chọn file ảnh mà bạn muốn sử dụng làm avatar từ máy tính của bạn.
-------------------------------------------------------------------------------------------------------------------------------

Quên mật khẩu	POST	http://localhost:5000/api/auth/forgot-password		Gửi email chứa link reset có token
Gửi email chứa link reset có token (nhớ lưu token reset)
{
  "email": "ldj05587@jioso.com"
}
-------------------------------------------------------------------------------------------------------------------------------

Reset mật khẩu	POST	http://localhost:5000/api/auth/reset-password		Đổi mật khẩu mới từ link có token
{
    "token": "TOKEN_LẤY_TỪ_EMAIL_reset",
    "newPassword": "mật_khẩu_mới",
    "confirmPassword": "mật_khẩu_mới"
}

-------------------------------------------------------------------------------------------------------------------------------
Example table dynamoDB (user), create index (email)
{
 "userId": "a466a167-ee38-4b21-b9d1-eb9fb1cdffad",
 "avatarUrl": "https://up-load-file-tranquocanh.s3.ap-southeast-2.amazonaws.com/avatars/076a6339-53d1-4682-986d-54520c63185c.jpg",
 "createdAt": "2025-04-09T06:18:25.497Z",
 "email": "ldj05587@jioso.com",
 "isVerified": true,
 "passwordHash": "$2b$10$/mN8OklB4MnboqxK2fwKduqaxuuwEVJt0AMfvPBAei7IgmgSxl8m.",
 "role": "user",
 "username": "Nguyen thi b"
}
------------------------------------------------------------------------------------------------------------------------------
CHỨC NĂNG TÌM KIẾM THEO EMAIL -> TRẢ VỀ userId
-----------------------------------------------
1. login để lấy token ->lưu token ( thêm Bearer Token ở phần Authorization > Bearer Token)

2. GET:         http://localhost:5000/api/user/search?email=test@example.com
		
-> userId được trả về

-----------------------------------------------------------------------------------------------------------------------------------
CHỨC NĂNG THÊM BẠN BÈ
-------------------------------------------------------------------------------------------------------------------------------

FriendRequests (TABLE)  + Index name: toEmail
{
 "requestId": "3153965a-93d7-421f-bea9-30e9d0ddaef2",
 "createdAt": "2025-04-17T15:43:39.032Z",
 "fromEmail": "yowopi3931@linxues.com",
 "status": "declined",
 "toEmail": "ldj05587@jioso.com"
}

Friends (TABLE)
{
 "friendshipId": "a8a2992f-dc55-4ab4-9877-11d786f6bf2f",
 "createdAt": "2025-04-17T15:53:58.692Z",
 "user1Email": "yowopi3931@linxues.com",
 "user2Email": "ldj05587@jioso.com"
}
----------------------------------------------------------------------------------------------------------------------------------
API			Method		URL							Mô tả
Gửi lời mời		POST		http://localhost:5000/api/friend/request		Gửi lời mời kết bạn
1. LOGIN VÀO -> nhận dc token-> lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)
2. POST		http://localhost:5000/api/friend/request
{
  "email": "otheruser@gmail.com"
}
=> res
{
  "message": "Lời mời đã gửi",
  "requestId": "<uuid>"
}-------------------------

GET http://localhost:5000/api/friends/requests/received 
1. LOGIN VÀO -> nhận dc token-> lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)

nhận lời mời
-----------------------------------------------------------------------------------------------------------------------
Duyệt lời mời		POST		http://localhost:5000/api/friend/accept			Chấp nhận lời mời
1.email được gửi lời mời đăng nhập vào ->lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)
2. POST		http://localhost:5000/api/friend/accept
{
  "requestId": "<requestId>"
}
=>res
{
  "message": "Kết bạn thành công"
}
----------------------------------------------------------------------------------------------------------------------
Từ chối lời mời		POST		http://localhost:5000/api/friend/decline		Từ chối lời mời
1.email được gửi lời mời đăng nhập vào ->lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)
2. POST		http://localhost:5000/api/friend/decline
{
  "requestId": "<requestId>"
}
=>res
{
  "message": "Đã từ chối lời mời"
}
-----------------------------------------------------------------------------------------------------------------------
Xóa bạn			DELETE		http://localhost:5000/api/friend/remove			Unfriend 
1.đăng nhập vào ->lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)
2. DELETE		http://localhost:5000/api/friend/remove
{
  "email": "charlie@example.com"
}
=>res
{
  "message": "Đã xóa bạn"
}
-------------------------------------------------------------------------------------------------------------------------
Xem danh sách bạn bè 	GET		http://localhost:5000/api/friend/list			Xem danh sách bạn bè 
1.đăng nhập vào ->lưu token (thêm Bearer Token ở phần Authorization > Bearer Token)
2. GET		http://localhost:5000/api/friend/list
=>res
{
    "message": "Danh sách bạn bè",
    "friends": [
        {
            "email": "ldj05587@jioso.com",
            "username": "Nguyen thi",
            "avatarUrl": "https://up-load-file-tranquocanh.s3.ap-southeast-2.amazonaws.com/avatars/076a6339-53d1-4682-986d-54520c63185c.jpg"
        }
    ]
}

-=================================================================================================================
tạo bảng (group) trên dynamoDB
{
  "groupId": "uuid",
  "name": "Team UI/UX",
  "ownerId": "user_id_of_creator", // ID của người tạo nhóm (trưởng nhóm)
  "members": [
    { "userId": "user_id_of_creator", "role": "admin" }, // Trưởng nhóm
    { "userId": "user_id_1", "role": "co-admin" },       // Phó nhóm (được gán quyền)
    { "userId": "user_id_2", "role": "member" }
  ],
  "createdAt": "ISOString"
}
          API QUẢN LÝ NHÓM
ĐẦU TIỀN USER PHẢI ĐĂNG NHẬP VÀO HỆ THỐNG->
1. Tạo nhóm
POST http://localhost:5000/api/groups
{
    "name": "Nhóm Postman Test",
    "initialMembersEmails": ["yowopi3931@linxues.com", "ldj05587@jioso.com"]
}

2.lấy tất cả các nhóm của user
GET    http://localhost:5000/api/groups/my-groups

3.Gán Quyền Quản Trị phó nhóm
PUT	http://localhost:5000/api/groups/<groupId>/admins/<userIdToAssign>

4.Xóa Thành Viên
DELETE	http://localhost:5000/api/groups/<groupId>/members/<userIdToRemove>

5.Giải Tán Nhóm chia hành lý
DELETE	http://localhost:5000/api/groups/<groupId>


















