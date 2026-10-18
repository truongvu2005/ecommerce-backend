function errorHandler(err, req, res, next) {
  console.error('Lỗi hệ thống:', err);

  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `Lỗi upload file: ${err.message}` });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Lỗi máy chủ nội bộ!';

  res.status(statusCode).json({ error: message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Không tìm thấy đường dẫn ${req.originalUrl}` });
}

module.exports = { errorHandler, notFoundHandler };

