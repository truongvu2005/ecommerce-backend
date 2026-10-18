const pool = require('../config/db');

async function checkout(req, res, next) {
  const { cartId, shippingAddress, paymentMethod } = req.body;
  const userId = req.user?.userId || req.body.userId;

  if (!userId || !cartId || !shippingAddress || !paymentMethod) {
    return res.status(400).json({ error: 'Thiếu thông tin thanh toán bắt buộc' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN'); 

    // Kiểm tra chủ sở hữu giỏ hàng
    const cartCheck = await client.query('SELECT user_id FROM carts WHERE id = $1', [cartId]);
    if (cartCheck.rows.length === 0 || String(cartCheck.rows[0].user_id) !== String(userId)) {
      throw new Error('Giỏ hàng không hợp lệ hoặc không thuộc về bạn');
    }

    // Lấy chi tiết các item trong giỏ cùng thông tin tồn kho
    const cartItemsRes = await client.query(`
      SELECT ci.product_id, ci.quantity, p.name, p.price, p.inventory_count, (ci.quantity * p.price) AS subtotal
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
      FOR UPDATE OF p
    `, [cartId]);

    if (cartItemsRes.rows.length === 0) {
      throw new Error('Giỏ hàng trống, không thể thanh toán');
    }

    const items = cartItemsRes.rows;

    // 1. Kiểm tra tồn kho trước khi đặt hàng
    for (let item of items) {
      if (item.inventory_count < item.quantity) {
        throw new Error(`Sản phẩm "${item.name}" chỉ còn ${item.inventory_count} cái trong kho, không đủ số lượng ${item.quantity} bạn đặt!`);
      }
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

    // 2. Tạo Đơn hàng mới
    const orderRes = await client.query(`
      INSERT INTO orders (user_id, total_amount, status, shipping_address)
      VALUES ($1, $2, 'PENDING', $3)
      RETURNING id
    `, [userId, totalAmount, shippingAddress]);
    
    const orderId = orderRes.rows[0].id;

    // 3. Chuyển hàng sang order_items và TRỪ TỒN KHO ngay lập tức
    for (let item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `, [orderId, item.product_id, item.quantity, item.price]);
      
      await client.query(`
        UPDATE products 
        SET inventory_count = inventory_count - $1 
        WHERE id = $2
      `, [item.quantity, item.product_id]);
    }

    // 4. Ghi nhận thanh toán
    await client.query(`
      INSERT INTO payments (order_id, amount, provider, status)
      VALUES ($1, $2, $3, 'PROCESSING')
    `, [orderId, totalAmount, paymentMethod]);

    // 5. Xóa sạch giỏ hàng
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    // 6. Cam kết Transaction
    await client.query('COMMIT'); 

    res.status(201).json({
      message: 'Đặt hàng thành công!',
      orderId: orderId,
      totalAmount: totalAmount,
      paymentUrl: paymentMethod === 'VNPAY' ? `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?orderId=${orderId}` : null
    });

  } catch (error) {
    await client.query('ROLLBACK'); 
    console.error('Lỗi khi checkout:', error.message);
    res.status(400).json({ error: error.message || 'Lỗi server khi thanh toán' });
  } finally {
    client.release(); 
  }
}

async function getUserOrders(req, res, next) {
  const { userId } = req.params;

  const isAuthorized = req.user.role === 'admin' || req.user.role === 'ADMIN' || String(req.user.userId) === String(userId);
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Bạn không có quyền xem đơn hàng của người khác!' });
  }

  try {
    const ordersRes = await pool.query(`
      SELECT id, total_amount, status, created_at 
      FROM orders 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [userId]);
    
    res.status(200).json(ordersRes.rows);
  } catch (error) {
    next(error);
  }
}

async function getOrderDetail(req, res, next) {
  const { orderId } = req.params;
  try {
    const orderRes = await pool.query(`
      SELECT o.*, p.provider AS payment_method, p.status AS payment_status
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.id = $1
    `, [orderId]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    const order = orderRes.rows[0];
    const isAuthorized = req.user.role === 'admin' || req.user.role === 'ADMIN' || String(req.user.userId) === String(order.user_id);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Bạn không có quyền xem đơn hàng này!' });
    }

    const itemsRes = await pool.query(`
      SELECT oi.quantity, oi.unit_price, p.name, p.image_url
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);

    res.status(200).json({
      order: order,
      items: itemsRes.rows
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  checkout,
  getUserOrders,
  getOrderDetail
};

