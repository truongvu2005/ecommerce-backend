const pool = require('../config/db');

async function getCategories(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
}

async function getProducts(req, res, next) {
  try {
    const { page = 1, limit = 8, category, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let queryStr = 'SELECT * FROM products WHERE is_active = TRUE';
    let countQueryStr = 'SELECT COUNT(*) FROM products WHERE is_active = TRUE';
    const queryParams = [];
    let paramIndex = 1;

    if (category) {
      queryStr += ` AND category_id = $${paramIndex}`;
      countQueryStr += ` AND category_id = $${paramIndex}`;
      queryParams.push(category);
      paramIndex++;
    }

    if (search) {
      queryStr += ` AND name ILIKE $${paramIndex}`;
      countQueryStr += ` AND name ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`); 
      paramIndex++;
    }

    const countRes = await pool.query(countQueryStr, queryParams);
    const totalItems = parseInt(countRes.rows[0].count);
    const totalPages = Math.ceil(totalItems / Number(limit)) || 1;

    queryParams.push(Number(limit));
    queryParams.push(Number(offset));
    queryStr += ` ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    const productsRes = await pool.query(queryStr, queryParams);

    res.status(200).json({
      data: productsRes.rows,
      pagination: { 
        totalItems, 
        totalPages, 
        currentPage: parseInt(page), 
        limit: parseInt(limit) 
      }
    });
  } catch (error) {
    next(error);
  }
}

async function getProductById(req, res, next) {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCategories,
  getProducts,
  getProductById
};

