const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken } = require('../middlewares/auth');

router.use(authenticateToken);

router.post('/checkout', orderController.checkout);
router.get('/orders/:userId', orderController.getUserOrders);
router.get('/orders/detail/:orderId', orderController.getOrderDetail);

module.exports = router;

