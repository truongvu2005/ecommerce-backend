const { cloudinary } = require('../config/cloudinary');

/**
 * Trích xuất public_id từ đường dẫn Cloudinary URL
 * Hỗ trợ các định dạng URL có hoặc không có transformations, version (v12345...), và mọi đuôi ảnh
 */
function getCloudinaryPublicId(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl || !imageUrl.includes('res.cloudinary.com')) {
    return null;
  }

  try {
    const url = new URL(imageUrl);
    const pathname = url.pathname; // /<cloud_name>/image/upload/...
    const uploadIndex = pathname.indexOf('/upload/');
    if (uploadIndex === -1) return null;

    let pathAfterUpload = pathname.substring(uploadIndex + 8); // Bỏ qua '/upload/'

    // Tách version (ví dụ: v1773500414/...)
    const versionMatch = pathAfterUpload.match(/(?:^|\/)v\d+\/(.+)$/);
    if (versionMatch) {
      pathAfterUpload = versionMatch[1];
    } else {
      // Nếu không có version, loại bỏ transformation segment đầu tiên nếu có (vd: w_500,c_fill/...)
      const parts = pathAfterUpload.split('/');
      if (parts[0] && (parts[0].includes(',') || /^[a-z]_[a-z0-9_-]+$/i.test(parts[0]))) {
        parts.shift();
      }
      pathAfterUpload = parts.join('/');
    }

    // Loại bỏ phần mở rộng đuôi file (.jpg, .png, .webp, .jpeg, v.v.)
    const dotIndex = pathAfterUpload.lastIndexOf('.');
    if (dotIndex !== -1) {
      pathAfterUpload = pathAfterUpload.substring(0, dotIndex);
    }

    return pathAfterUpload ? decodeURIComponent(pathAfterUpload) : null;
  } catch (err) {
    console.error('Lỗi phân tích public_id từ URL Cloudinary:', err);
    return null;
  }
}

/**
 * Xóa một ảnh khỏi Cloudinary và làm mới CDN cache
 */
async function deleteImageFromCloudinary(imageUrl) {
  const publicId = getCloudinaryPublicId(imageUrl);
  if (!publicId) {
    return null;
  }

  try {
    console.log(`Đang xóa ảnh Cloudinary với publicId: ${publicId}`);
    const result = await cloudinary.uploader.destroy(publicId, { 
      resource_type: 'image', 
      invalidate: true 
    });
    console.log(`Kết quả xóa Cloudinary (${publicId}):`, result);
    return result;
  } catch (error) {
    console.error(`Lỗi khi xóa ảnh Cloudinary (${publicId}):`, error.message);
    return null;
  }
}

module.exports = { 
  deleteImageFromCloudinary, 
  deleteProductImage: deleteImageFromCloudinary, 
  getCloudinaryPublicId,
  getManagedProductImagePublicId: getCloudinaryPublicId 
};
