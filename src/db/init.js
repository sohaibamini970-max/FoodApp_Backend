const fs = require("fs");
const path = require("path");
const db = require("../config/db");

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await db.query(sql);
    console.log("✅ Database schema initialized");
    process.exit(0);
  } catch (err) {
    console.error("❌ Schema init failed:", err);
    process.exit(1);
  }
})();