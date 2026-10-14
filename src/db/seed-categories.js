require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const categories = [
    { name: "burgers", icon: "🍔" },
    { name: "pizza", icon: "🍕" },
    { name: "sushi", icon: "🍣" },
    { name: "pasta", icon: "🍝" },
    { name: "desserts", icon: "🍰" },
    { name: "drinks", icon: "🥤" },
    { name: "salads", icon: "🥗" },
];

(async () => {
    try {
        for (const c of categories) {
            await pool.query(
                `INSERT INTO categories (name, slug, icon)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING`,
                [c.name, c.name, c.icon]
            );
        }
        console.log(`✅ Seeded ${categories.length} categories`);

        const { rows } = await pool.query(
            "SELECT id, name, icon FROM categories ORDER BY id"
        );
        console.table(rows);
    } catch (e) {
        console.error("❌", e.message);
    } finally {
        await pool.end();
    }
})();