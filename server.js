require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Khởi tạo kết nối PostgreSQL
require('./src/config/db');

const routes = require('./src/routes');
const { errorHandler, notFoundHandler } = require('./src/middlewares/errorHandler');

const app = express();

// Cấu hình CORS
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:3001', 
    'https://vutech-shop.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Body parser
app.use(express.json());

// Gắn toàn bộ API phiên bản 1
app.use('/v1', routes);

// Middleware xử lý lỗi 404 và Error Handler toàn cục
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});

module.exports = app;