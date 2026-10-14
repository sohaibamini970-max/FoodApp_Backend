const { verifyAccess } = require("../utils/jwt");
const db = require("../config/db");

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    const decoded = verifyAccess(token);
    const { rows } = await db.query(
      "SELECT id, name, email, role, is_active FROM users WHERE id=$1",
      [decoded.sub]
    );
    if (!rows.length || !rows[0].is_active)
      return res.status(401).json({ message: "User not found or inactive" });

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
};

module.exports = { protect, requireAdmin };