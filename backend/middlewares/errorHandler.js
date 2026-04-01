export const notFoundHandler = (req, res) => {
  return res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

export const errorHandler = (error, _req, res, _next) => {
  console.error(error);

  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal server error";

  return res.status(statusCode).json({ message });
};
