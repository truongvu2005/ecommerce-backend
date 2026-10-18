const pool = require('../config/db');
const { deleteImageFromCloudinary } = require('../services/cloudinaryService');

async function getUserProfile(req, res, next) {
  try {
    const { id } = req.params;

    const isAuthorized = req.user.role === 'admin' || req.user.role === 'ADMIN' || String(req.user.userId) === String(id);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Bạn không có quyền xem thông tin người dùng này!' });
    }

    const userRes = await pool.query(
      'SELECT id, email, full_name, role, phone, address, avatar_url FROM users WHERE id = $1', 
      [id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy user' });
    res.status(200).json(userRes.rows[0]);
  } catch (error) {
    next(error);
  }
}

async function updateUserProfile(req, res, next) {
  try {
    const { id } = req.params;

    const isAuthorized = req.user.role === 'admin' || req.user.role === 'ADMIN' || String(req.user.userId) === String(id);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Bạn không có quyền cập nhật người dùng này!' });
    }

    const { full_name, phone, address, avatar_url } = req.body;
    
    // Nếu đổi avatar mới khác avatar cũ, tự động xóa avatar cũ trên Cloudinary
    if (avatar_url) {
      const oldUserRes = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [id]);
      const oldAvatarUrl = oldUserRes.rows[0]?.avatar_url;
      if (oldAvatarUrl && oldAvatarUrl !== avatar_url) {
        deleteImageFromCloudinary(oldAvatarUrl).catch(err => {
          console.warn('Lỗi khi xóa avatar cũ trên Cloudinary:', err.message);
        });
      }
    }

    const updateRes = await pool.query(
      `UPDATE users 
       SET full_name = $1, phone = $2, address = $3, avatar_url = $4 
       WHERE id = $5 
       RETURNING id, email, full_name, role, phone, address, avatar_url`,
      [full_name, phone, address, avatar_url, id]
    );
    
    res.status(200).json({ message: 'Cập nhật thành công!', user: updateRes.rows[0] });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUserProfile,
  updateUserProfile
};

