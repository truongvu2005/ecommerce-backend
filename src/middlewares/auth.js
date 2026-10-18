const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'chuoi_bao_mat_sieu_cap_vu_tru_123';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7).trim() 
    : (authHeader || req.query.token);

  if (!token) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập để thực hiện hành động này!' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn!' });
    }
    req.user = decoded;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Chưa xác thực người dùng!' });
  }

  const role = (req.user.role || '').toUpperCase();
  if (role !== 'ADMIN') {
    return res.status(403).json({ error: 'Bạn không có quyền quản trị viên (Admin)!' });
  }

  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET
};

