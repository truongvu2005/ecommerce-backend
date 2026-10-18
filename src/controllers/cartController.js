const pool = require('../config/db');

async function getCart(req, res, next) {
  const { userId } = req.params;

  const isAuthorized = req.user.role === 'admin' || req.user.role === 'ADMIN' || String(req.user.userId) === String(userId);
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập giỏ hàng của người khác!' });
  }

  try {
    const cartRes = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);

    if (cartRes.rows.length === 0) {
      return res.status(200).json({ message: 'Giỏ hàng trống', items: [], totalPrice: 0 });
    }

    const cartId = cartRes.rows[0].id;

    const itemsRes = await pool.query(`
      SELECT 
        ci.product_id AS "productId", 
        p.name, 
        p.image_url,
        p.inventory_count,
        ci.quantity, 
        p.price AS "unitPrice", 
        (ci.quantity * p.price) AS "subTotal"
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);

    const items = itemsRes.rows;
    const totalPrice = items.reduce((sum, item) => sum + Number(item.subTotal), 0);

    res.status(200).json({
      cartId: cartId,
      totalItems: items.length,
      totalPrice: totalPrice,
      items: items
    });
  } catch (error) {
    next(error);
  }
}

async function addToCart(req, res, next) {
  const { productId, quantity = 1 } = req.body;
  const userId = req.user?.userId || req.body.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập để thêm vào giỏ hàng' });
  }

  if (!productId || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'Thông tin sản phẩm hoặc số lượng không hợp lệ' });
  }

  try {
    const prodCheck = await pool.query('SELECT inventory_count, is_active FROM products WHERE id = $1', [productId]);
    if (prodCheck.rows.length === 0 || !prodCheck.rows[0].is_active) {
      return res.status(404).json({ error: 'Sản phẩm không tồn tại hoặc đã ngừng bán' });
    }

    let cartRes = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    let cartId;

    if (cartRes.rows.length === 0) {
      const newCart = await pool.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING id', 
        [userId]
      );
      cartId = newCart.rows[0].id; 
    } else {
      cartId = cartRes.rows[0].id; 
    }

    const checkItem = await pool.query(
      'SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, productId]
    );

    if (checkItem.rows.length > 0) {
      await pool.query(
        'UPDATE cart_items SET quantity = quantity + $1 WHERE cart_id = $2 AND product_id = $3',
        [quantity, cartId, productId]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
        [cartId, productId, quantity]
      );
    }
    res.status(200).json({ message: 'Thêm vào giỏ thành công!' });
  } catch (error) {
    next(error);
  }
}

async function updateCartItem(req, res, next) {
  const { cartId, productId } = req.params;
  const { quantity } = req.body;

  try {
    const cartOwner = await pool.query('SELECT user_id FROM carts WHERE id = $1', [cartId]);
    if (cartOwner.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy giỏ hàng' });
    }
    if (req.user.role !== 'admin' && req.user.role !== 'ADMIN' && String(cartOwner.rows[0].user_id) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa giỏ hàng này' });
    }

    if (Number(quantity) <= 0) {
      await pool.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
    } else {
      await pool.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3', [quantity, cartId, productId]);
    }
    res.status(200).json({ message: 'Cập nhật số lượng thành công' });
  } catch (error) {
    next(error);
  }
}

async function removeCartItem(req, res, next) {
  const { cartId, productId } = req.params;

  try {
    const cartOwner = await pool.query('SELECT user_id FROM carts WHERE id = $1', [cartId]);
    if (cartOwner.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy giỏ hàng' });
    }
    if (req.user.role !== 'admin' && req.user.role !== 'ADMIN' && String(cartOwner.rows[0].user_id) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền thao tác trên giỏ hàng này' });
    }

    await pool.query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', 
      [cartId, productId]
    );
    res.status(200).json({ message: 'Đã xóa sản phẩm khỏi giỏ hàng' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem
};

