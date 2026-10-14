const db = require("../config/db");
const { hashPassword } = require("../utils/password");
require("dotenv").config();

(async () => {
  try {
    const password_hash = await hashPassword("admin123");
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      ["Admin", "admin@foodiehub.com", password_hash]
    );
    console.log("✅ Admin seeded: admin@foodiehub.com / admin123");

    const userHash = await hashPassword("password");
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'user', TRUE)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash`,
      ["John Doe", "john@example.com", userHash]
    );
    console.log("✅ User seeded: john@example.com / password");

    process.exit(0);
  } catch (e) {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  }
})();