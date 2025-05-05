const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
// nhận url từ client sau đó gửi mail theo đường dẫn đó
const sendVerificationEmail = async (to, token , origin) => {

  const html = await ejs.renderFile(
    path.join(__dirname, '../views/verifyEmail.ejs'),
    {
      verifyLink: `${origin}/api/auth/verify-email?token=${token}`,
    }
  );

  const options = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Xác minh tài khoản ZALO_MINI',
    html,
  };

  await transporter.sendMail(options);
};

const sendVerificationEmailApp = async (to, token, origin) => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/verifyEmail.ejs'),
    {
      verifyLink: `${origin}/api/auth/verify-email-app?token=${token}`,
      token: token,
    }
  );

  const options = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Xác minh tài khoản ZALO_MINI',
    html,
  };

  await transporter.sendMail(options);
};

const sendResetPasswordEmail = async (to, token) => {
  const link = `${process.env.CLIENT_URL}/api/auth/reset-password?token=${token}`;

  const options = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Khôi phục mật khẩu ZALO_MINI',
    html: `<p>Nhấp vào liên kết sau để đặt lại mật khẩu:</p><a href="${link}">${link}</a>`,
  };

  await transporter.sendMail(options);
};

const sendResetPasswordEmailApp = async (to, token) => {
  // Mã hóa token để tránh lỗi ký tự đặc biệt
  const encodedToken = encodeURIComponent(token);
  const link = `${process.env.EXPO_URL}/--/reset-password-app?token=${encodedToken}`;
  console.log('Generated reset password link:', link);
  const options = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Khôi phục mật khẩu ZALO_MINI',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            p { font-size: 16px; line-height: 1.5; }
            a.button { display: inline-block; margin: 10px 0; padding: 12px 24px; background-color: #0068FF; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .link-text { word-break: break-all; color: #0068FF; }
          </style>
        </head>
        <body>
          <h2>Khôi phục mật khẩu ZALO_MINI</h2>
          <p>Để đặt lại mật khẩu, vui lòng nhấp vào nút bên dưới:</p>
          <a class="button" href="${link}">Đặt lại mật khẩu</a>
          <p>Nếu nút không hoạt động, sao chép và dán liên kết sau:</p>
          <p class="link-text">${link}</p>
          <p>Liên kết này có hiệu lực trong 1 giờ.</p>
          <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
        </body>
      </html>
    `,
  };

  await transporter.sendMail(options);
  console.log('Email đặt lại mật khẩu đã gửi đến:', to, 'với link:', link);
};

module.exports = { sendVerificationEmail, sendResetPasswordEmail , sendResetPasswordEmailApp, sendVerificationEmailApp };
