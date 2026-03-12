require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const JWT_SECRET = process.env.JWT_SECRET || 'chuoi_bao_mat_sieu_cap_vu_tru_123';

const app = express();
app.use(cors());
app.use(express.json()); // Để parse JSON từ request body

// 1. Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Cấu hình Multer để lưu tạm ảnh vào Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vutech_products', // Tên thư mục trên Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'] // Định dạng ảnh được phép tải lên,
  },
});
const upload = multer({ storage: storage });




// // Cấu hình kết nối PostgreSQL
// const pool = new Pool({
//   user: process.env.DB_USER,
//   host: process.env.DB_HOST,
//   database: process.env.DB_NAME,
//   password: process.env.DB_PASSWORD,
//   port: process.env.DB_PORT,
// });

// Kết nối với Database trên Cloud (Neon/Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Bắt buộc phải có cái này khi dùng Cloud DB
  }
});

// Kiểm tra kết nối DB
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Lỗi kết nối database:', err.stack);
  }
  console.log('✅ Đã kết nối thành công tới PostgreSQL!');
  release();
});

// API Test cơ bản
app.get('/v1/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'E-commerce API đang chạy!' });
});

// 3. API Upload ảnh duy nhất
app.post('/v1/admin/upload', upload.single('image'), (req, res) => {
  try {
    // req.file.path chính là cái link ảnh thật trên Cloudinary
    res.status(200).json({ imageUrl: req.file.path });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi upload ảnh' });
  }
});

// API: Thêm sản phẩm vào giỏ hàng (Thông minh: Tự tạo giỏ nếu khách chưa có)
app.post('/v1/cart/items', async (req, res) => {
  const { userId, productId, quantity } = req.body;
  try {
    // Sửa thành SELECT * cho an toàn
    let cartRes = await pool.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    let cartId;

    if (cartRes.rows.length === 0) {
      const newCart = await pool.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING *', 
        [userId]
      );
      cartId = newCart.rows[0].id; 
    } else {
      cartId = cartRes.rows[0].id; 
    }

    const checkItem = await pool.query(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2',
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
    console.error('Lỗi khi thêm vào giỏ:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Xem chi tiết giỏ hàng của User
app.get('/v1/cart/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    // 1. Tìm giỏ hàng của user này
    const cartRes = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);

    // Nếu chưa có giỏ hàng thì trả về rỗng
    if (cartRes.rows.length === 0) {
      return res.status(200).json({ message: 'Giỏ hàng trống', items: [], totalPrice: 0 });
    }

    const cartId = cartRes.rows[0].id;

    // 2. Lấy danh sách sản phẩm (Dùng JOIN để lấy tên và giá từ bảng products)
    const itemsRes = await pool.query(`
      SELECT 
        ci.product_id AS "productId", 
        p.name, 
        ci.quantity, 
        p.price AS "unitPrice", 
        (ci.quantity * p.price) AS "subTotal"
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);

    const items = itemsRes.rows;

    // 3. Tính tổng tiền toàn bộ giỏ hàng
    const totalPrice = items.reduce((sum, item) => sum + Number(item.subTotal), 0);

    // Trả kết quả về cho Frontend
    res.status(200).json({
      cartId: cartId,
      totalItems: items.length,
      totalPrice: totalPrice,
      items: items
    });

  } catch (error) {
    console.error('Lỗi khi lấy giỏ hàng:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy giỏ hàng' });
  }
});

// API: Checkout - Tạo đơn hàng từ giỏ hàng
app.post('/v1/checkout', async (req, res) => {
  const { userId, cartId, shippingAddress, paymentMethod } = req.body;

  if (!userId || !cartId || !shippingAddress || !paymentMethod) {
    return res.status(400).json({ error: 'Thiếu thông tin thanh toán bắt buộc' });
  }

  // Khởi tạo một kết nối riêng biệt để chạy Transaction
  const client = await pool.connect();

  try {
    // 1. BẮT ĐẦU TRANSACTION (Bắt buộc)
    await client.query('BEGIN'); 

    // 2. Lấy toàn bộ sản phẩm trong giỏ hàng để tính tiền
    const cartItemsRes = await client.query(`
      SELECT ci.product_id, ci.quantity, p.price, (ci.quantity * p.price) AS subtotal
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);

    if (cartItemsRes.rows.length === 0) {
      throw new Error('Giỏ hàng trống, không thể thanh toán');
    }

    const items = cartItemsRes.rows;
    // Tính tổng tiền đơn hàng
    const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

    // 3. Tạo Đơn hàng mới (Lưu vào bảng orders)
    const orderRes = await client.query(`
      INSERT INTO orders (user_id, total_amount, status, shipping_address)
      VALUES ($1, $2, 'PENDING', $3)
      RETURNING id
    `, [userId, totalAmount, shippingAddress]);
    
    const orderId = orderRes.rows[0].id;

    // 4. Chuyển hàng từ Giỏ sang Chi tiết đơn hàng (Lưu vào bảng order_items)
    for (let item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `, [orderId, item.product_id, item.quantity, item.price]);
      
      // (Trong thực tế, bạn sẽ viết thêm lệnh trừ số lượng tồn kho (inventory_count) ở bảng products tại đây)
    }

    // 5. Ghi nhận giao dịch Thanh toán (Lưu vào bảng payments)
    await client.query(`
      INSERT INTO payments (order_id, amount, provider, status)
      VALUES ($1, $2, $3, 'PROCESSING')
    `, [orderId, totalAmount, paymentMethod]);

    // 6. Xóa sạch giỏ hàng (Vì khách đã mua xong)
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    // 7. XÁC NHẬN TRANSACTION THÀNH CÔNG (Lưu vĩnh viễn vào DB)
    await client.query('COMMIT'); 

    // Trả kết quả về cho Frontend
    res.status(201).json({
      message: 'Đặt hàng thành công!',
      orderId: orderId,
      totalAmount: totalAmount,
      // Trả về một URL giả lập cổng thanh toán VNPay để Frontend chuyển hướng
      paymentUrl: paymentMethod === 'VNPAY' ? `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?orderId=${orderId}` : null
    });

  } catch (error) {
    // NẾU CÓ LỖI: HOÀN TÁC TOÀN BỘ (Không lưu gì cả)
    await client.query('ROLLBACK'); 
    console.error('Lỗi khi checkout:', error.message);
    res.status(500).json({ error: error.message || 'Lỗi server khi thanh toán' });
  } finally {
    // Trả kết nối lại cho hệ thống
    client.release(); 
  }
});

// API: Lấy danh sách đơn hàng của User
app.get('/v1/orders/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const ordersRes = await pool.query(`
      SELECT id, total_amount, status, created_at 
      FROM orders 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [userId]);
    
    res.status(200).json(ordersRes.rows);
  } catch (error) {
    console.error('Lỗi lấy đơn hàng:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API: Lấy danh sách toàn bộ sản phẩm
app.get('/v1/products', async (req, res) => {
  try {
    const productsRes = await pool.query(`
      SELECT id, sku, name, price, image_url 
      FROM products 
      WHERE is_active = TRUE 
      ORDER BY name ASC
    `);
    
    res.status(200).json(productsRes.rows);
  } catch (error) {
    console.error('Lỗi lấy danh sách sản phẩm:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy sản phẩm' });
  }
});

// API: Xóa một sản phẩm khỏi giỏ hàng
app.delete('/v1/cart/:cartId/product/:productId', async (req, res) => {
  const { cartId, productId } = req.params;

  try {
    // Xóa dòng dữ liệu tương ứng trong bảng cart_items
    await pool.query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', 
      [cartId, productId]
    );
    res.status(200).json({ message: 'Đã xóa sản phẩm khỏi giỏ hàng' });
  } catch (error) {
    console.error('Lỗi khi xóa sản phẩm:', error);
    res.status(500).json({ error: 'Lỗi server khi xóa' });
  }
});

// ==========================================
// KHU VỰC API DÀNH CHO ADMIN (CHỦ SHOP)
// ==========================================

// API 1: Lấy toàn bộ danh sách đơn hàng trong hệ thống
app.get('/v1/admin/orders', async (req, res) => {
  try {
    // Dùng JOIN để lấy luôn tên và email của người mua từ bảng users
    const query = `
      SELECT o.id, o.total_amount, o.status, o.created_at, o.shipping_address, u.full_name, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Lỗi lấy đơn hàng Admin:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API 2: Cập nhật trạng thái đơn hàng (PENDING -> SHIPPED -> COMPLETED)
app.put('/v1/admin/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; 

  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.status(200).json({ message: 'Cập nhật trạng thái thành công!' });
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API Admin: Tạo sản phẩm mới kèm Link ảnh
app.post('/v1/admin/products', async (req, res) => {
  const { sku, name, price, inventory_count, image_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (sku, name, price, inventory_count, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [sku, name, price, inventory_count || 10, image_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Admin: Cập nhật (Sửa) thông tin sản phẩm
app.put('/v1/admin/products/:id', async (req, res) => {
  const { id } = req.params;
  const { sku, name, price, inventory_count, image_url } = req.body;
  try {
    const result = await pool.query(
      'UPDATE products SET sku = $1, name = $2, price = $3, inventory_count = $4, image_url = $5 WHERE id = $6 RETURNING *',
      [sku, name, price, inventory_count || 10, image_url, id]
    );
    res.status(200).json({ message: 'Cập nhật thành công!', product: result.rows[0] });
  } catch (error) {
    console.error('Lỗi cập nhật sản phẩm:', error);
    res.status(500).json({ error: 'Lỗi server khi cập nhật' });
  }
});

// API Admin: Xóa (Ẩn) sản phẩm (Soft Delete)
app.delete('/v1/admin/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Chúng ta cập nhật is_active = FALSE thay vì DELETE để giữ lại lịch sử đơn hàng
    await pool.query('UPDATE products SET is_active = FALSE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Đã xóa sản phẩm khỏi cửa hàng!' });
  } catch (error) {
    console.error('Lỗi xóa sản phẩm:', error);
    res.status(500).json({ error: 'Lỗi server khi xóa' });
  }
});

// ==========================================
// KHU VỰC API XÁC THỰC (AUTH)
// ==========================================

// API: Đăng ký tài khoản (Register)
app.post('/v1/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Vui lòng nhập đủ email, mật khẩu và họ tên' });
  }

  try {
    // 1. Mã hóa mật khẩu (Băm 10 vòng)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 2. Lưu vào Database
    const newUser = await pool.query(
      'INSERT INTO users (email, password, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name',
      [email, hashedPassword, fullName]
    );

    res.status(201).json({ 
      message: 'Đăng ký thành công!', 
      user: newUser.rows[0] 
    });
  } catch (error) {
    console.error('Lỗi đăng ký:', error);
    // Mã 23505 của Postgres là lỗi trùng lặp (Duplicate)
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email này đã được sử dụng!' });
    }
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API: Đăng nhập (Login)
app.post('/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Tìm user theo email
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Email không tồn tại!' });
    }
    
    const user = userRes.rows[0];

    // 2. Kiểm tra mật khẩu xem có khớp với cục hash trong DB không
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Sai mật khẩu!' });
    }

    // 3. Tạo Token (Thẻ từ) có hạn dùng 1 ngày
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ 
      message: 'Đăng nhập thành công!', 
      token: token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role // <--- CHỈ CẦN THÊM ĐÚNG DÒNG NÀY
      }
    });

  } catch (error) {
    console.error('Lỗi đăng nhập:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});