const AWS = require('aws-sdk');


AWS.config.update({
    region: process.env.AWS_REGION // Đảm bảo region được cấu hình
});
const s3 = new AWS.S3();
const uploadImageToS3 = async (file) => {
  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `messages/${Date.now()}_${file.originalname}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const uploadResult = await s3.upload(params).promise();
    console.log('uploadResult:', uploadResult);

    if (!uploadResult.Location || typeof uploadResult.Location !== 'string') {
      throw new Error('URL file từ S3 không hợp lệ');
    }

    return uploadResult;
  } catch (error) {
    console.error('Lỗi khi upload lên S3:', error);
    throw error;
  }
};

module.exports = uploadImageToS3;