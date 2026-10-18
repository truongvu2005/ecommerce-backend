const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

// Bắt buộc xác thực cho mọi route admin
router.use(authenticateToken);

// Upload ảnh (yêu cầu đã đăng nhập)
router.post('/upload', upload.single('image'), adminController.uploadImage);

// Các route quản trị cần quyền ADMIN
router.use(requireAdmin);

router.get('/orders', adminController.getAdminOrders);
router.put('/orders/:id/status', adminController.updateOrderStatus);
router.post('/products', adminController.createProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

module.exports = router;

