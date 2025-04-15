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
 "userId": "284b5157-61c1-447d-8312-8a8d9c9d71d6",
 "avatarUrl": "https://up-load-file-tranquocanh.s3.amazonaws.com/default-avatar.png",
 "createdAt": "2025-04-09T03:57:20.570Z",
 "email": "plr95697@bcooq.com",
 "isVerified": true,
 "passwordHash": "$2b$10$KBgjOLXtF1BANAxFo1PmcuKb/UnMsMwlBf6nSZPBKMjvMQiS4.1pq",
 "role": "user"
}
------------------------------------------------------------------------------------------------------------------------------
