require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const schemaPath = path.join(__dirname, "src", "db", "schema.sql");

    if (!fs.existsSync(schemaPath)) {
      console.error("❌ schema.sql not found at:", schemaPath);
      process.exit(1);
    }

    const sql = fs.readFileSync(schemaPath, "utf8");
    console.log("📄 Applying schema.sql …");
    await pool.query(sql);
    console.log("✅ Schema applied");

    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    console.log(
      "📋 Tables:",
      rows.map((r) => r.table_name)
    );

    process.exit(0);
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
})();