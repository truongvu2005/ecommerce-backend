const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const productRoutes = require('./productRoutes');
const cartRoutes = require('./cartRoutes');
const orderRoutes = require('./orderRoutes');
const userRoutes = require('./userRoutes');
const adminRoutes = require('./adminRoutes');

// API Health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'E-commerce API đang chạy ổn định!' });
});

router.use('/auth', authRoutes);
router.use('/', productRoutes);
router.use('/cart', cartRoutes);
router.use('/', orderRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);

module.exports = router;

