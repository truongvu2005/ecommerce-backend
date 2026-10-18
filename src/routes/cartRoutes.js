const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { authenticateToken } = require('../middlewares/auth');

router.use(authenticateToken);

router.get('/:userId', cartController.getCart);
router.post('/items', cartController.addToCart);
router.put('/:cartId/product/:productId', cartController.updateCartItem);
router.delete('/:cartId/product/:productId', cartController.removeCartItem);

module.exports = router;

