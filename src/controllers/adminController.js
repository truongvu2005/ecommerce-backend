const pool = require('../config/db');
const { deleteImageFromCloudinary } = require('../services/cloudinaryService');

function uploadImage(req, res) {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: 'Chưa có file ảnh được tải lên' });
    }
    res.status(200).json({ imageUrl: req.file.path });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi upload ảnh' });
  }
}

async function getAdminOrders(req, res, next) {
  try {
    const query = `
      SELECT o.id, o.total_amount, o.status, o.created_at, o.shipping_address, u.full_name, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
}

async function updateOrderStatus(req, res, next) {
  const { id } = req.params;
  const { status } = req.body; 

  if (!status) {
    return res.status(400).json({ error: 'Thiếu trạng thái đơn hàng' });
  }

  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.status(200).json({ message: 'Cập nhật trạng thái thành công!' });
  } catch (error) {
    next(error);
  }
}

async function createProduct(req, res, next) {
  const { sku, name, price, inventory_count, image_url, category_id } = req.body;

  if (!sku || !name || price === undefined) {
    return res.status(400).json({ error: 'Vui lòng điền đủ SKU, tên sản phẩm và giá' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO products (sku, name, price, inventory_count, image_url, category_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [sku, name, price, inventory_count || 10, image_url, category_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req, res, next) {
  const { id } = req.params;
  const { sku, name, price, inventory_count, image_url, category_id } = req.body;
  try {
    // Nếu có ảnh mới khác ảnh cũ, tự động xóa ảnh cũ trên Cloudinary để giải phóng dung lượng
    if (image_url) {
      const oldProd = await pool.query('SELECT image_url FROM products WHERE id = $1', [id]);
      const oldImageUrl = oldProd.rows[0]?.image_url;
      if (oldImageUrl && oldImageUrl !== image_url) {
        deleteImageFromCloudinary(oldImageUrl).catch(err => {
          console.warn('Lỗi khi xóa ảnh cũ sản phẩm:', err.message);
        });
      }
    }

    const result = await pool.query(
      'UPDATE products SET sku = $1, name = $2, price = $3, inventory_count = $4, image_url = $5, category_id = $6 WHERE id = $7 RETURNING *',
      [sku, name, price, inventory_count || 10, image_url, category_id || null, id]
    );
    res.status(200).json({ message: 'Cập nhật thành công!', product: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

async function deleteProduct(req, res, next) {
  const { id } = req.params;
  try {
    const prodRes = await pool.query('SELECT image_url FROM products WHERE id = $1', [id]);
    if (prodRes.rows.length > 0 && prodRes.rows[0].image_url) {
      try {
        await deleteImageFromCloudinary(prodRes.rows[0].image_url);
      } catch (cloudErr) {
        console.warn('Cảnh báo xóa ảnh Cloudinary:', cloudErr.message);
      }
    }

    await pool.query(
      "UPDATE products SET is_active = FALSE, sku = sku || '-deleted-' || id WHERE id = $1", 
      [id]
    );
    res.status(200).json({ message: 'Đã xóa sản phẩm khỏi cửa hàng!' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadImage,
  getAdminOrders,
  updateOrderStatus,
  createProduct,
  updateProduct,
  deleteProduct
};

