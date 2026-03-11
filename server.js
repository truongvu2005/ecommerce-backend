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

// --- 1. KHỞI TẠO APP TRƯỚC (CỰC KỲ QUAN TRỌNG) ---
const app = express();
app.use(cors());
app.use(express.json());

// --- 2. CẤU HÌNH CLOUDINARY & MULTER ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vutech_products',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});
const upload = multer({ storage: storage });

// --- 3. KẾT NỐI DATABASE ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) return console.error('Lỗi kết nối database:', err.stack);
  console.log('✅ Đã kết nối thành công tới PostgreSQL!');
});

// ==========================================
// KHU VỰC ĐỊNH NGHĨA API (ROUTES)
// ==========================================

// API Test
app.get('/v1/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'E-commerce API đang chạy!' });
});

// API Admin: Upload ảnh lên Cloudinary
app.post('/v1/admin/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không có file nào được tải lên' });
    res.status(200).json({ imageUrl: req.file.path });
  } catch (error) {
    console.error('Lỗi upload ảnh:', error);
    res.status(500).json({ error: 'Lỗi upload ảnh' });
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

// API: Thêm sản phẩm vào giỏ hàng
app.post('/v1/cart/items', async (req, res) => {
  const { userId, productId, quantity } = req.body;
  try {
    let cartRes = await pool.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    let cartId;
    if (cartRes.rows.length === 0) {
      const newCart = await pool.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING *', [userId]);
      cartId = newCart.rows[0].id; 
    } else {
      cartId = cartRes.rows[0].id; 
    }
    const checkItem = await pool.query('SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
    if (checkItem.rows.length > 0) {
      await pool.query('UPDATE cart_items SET quantity = quantity + $1 WHERE cart_id = $2 AND product_id = $3', [quantity, cartId, productId]);
    } else {
      await pool.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)', [cartId, productId, quantity]);
    }
    res.status(200).json({ message: 'Thêm vào giỏ thành công!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Xem giỏ hàng
app.get('/v1/cart/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const cartRes = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(200).json({ items: [], totalPrice: 0 });
    const cartId = cartRes.rows[0].id;
    const itemsRes = await pool.query(`
      SELECT ci.product_id AS "productId", p.name, ci.quantity, p.price AS "unitPrice", (ci.quantity * p.price) AS "subTotal"
      FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = $1
    `, [cartId]);
    const items = itemsRes.rows;
    const totalPrice = items.reduce((sum, item) => sum + Number(item.subTotal), 0);
    res.status(200).json({ cartId, totalItems: items.length, totalPrice, items });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi lấy giỏ hàng' });
  }
});

// API: Checkout
app.post('/v1/checkout', async (req, res) => {
  const { userId, cartId, shippingAddress, paymentMethod } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); 
    const cartItemsRes = await client.query(`
      SELECT ci.product_id, ci.quantity, p.price, (ci.quantity * p.price) AS subtotal
      FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.cart_id = $1
    `, [cartId]);
    if (cartItemsRes.rows.length === 0) throw new Error('Giỏ hàng trống');
    const items = cartItemsRes.rows;
    const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
    const orderRes = await client.query('INSERT INTO orders (user_id, total_amount, status, shipping_address) VALUES ($1, $2, \'PENDING\', $3) RETURNING id', [userId, totalAmount, shippingAddress]);
    const orderId = orderRes.rows[0].id;
    for (let item of items) {
      await client.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)', [orderId, item.product_id, item.quantity, item.price]);
    }
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
    await client.query('COMMIT'); 
    res.status(201).json({ message: 'Đặt hàng thành công!', orderId, totalAmount });
  } catch (error) {
    await client.query('ROLLBACK'); 
    res.status(500).json({ error: error.message });
  } finally {
    client.release(); 
  }
});

// API: Lấy danh sách sản phẩm
app.get('/v1/products', async (req, res) => {
  try {
    const productsRes = await pool.query('SELECT id, sku, name, price, image_url FROM products WHERE is_active = TRUE ORDER BY name ASC');
    res.status(200).json(productsRes.rows);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi lấy sản phẩm' });
  }
});

// API Admin: Lấy danh sách đơn hàng
app.get('/v1/admin/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT o.*, u.full_name, u.email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC');
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API Admin: Cập nhật trạng thái đơn hàng
app.put('/v1/admin/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; 
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.status(200).json({ message: 'Cập nhật thành công!' });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API Auth: Register
app.post('/v1/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = await pool.query('INSERT INTO users (email, password, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name', [email, hashedPassword, fullName]);
    res.status(201).json({ message: 'Đăng ký thành công!', user: newUser.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Email đã tồn tại!' });
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API Auth: Login
app.post('/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Email không tồn tại!' });
    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Sai mật khẩu!' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });
    res.status(200).json({ message: 'Đăng nhập thành công!', token, user: { id: user.id, email: user.email, full_name: user.full_name } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});