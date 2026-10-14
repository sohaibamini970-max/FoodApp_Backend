const db = require("../config/db");
const {
    validateCategoryName,
    validateCategoryIcon,
    validateImage,
} = require("../utils/validators");

const slugify = (s) =>
    s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

// GET /api/categories
exports.listCategories = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT c.*, COUNT(p.id)::int AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`
        );
        res.json({ categories: rows });
    } catch (err) {
        next(err);
    }
};

// POST /api/admin/categories
exports.createCategory = async (req, res, next) => {
    try {
        const { name, icon, icon_url } = req.body;

        const nameErr = validateCategoryName(name);
        if (nameErr) return res.status(400).json({ message: nameErr });

        const iconErr = validateCategoryIcon(icon);
        if (iconErr) return res.status(400).json({ message: iconErr });

        if (icon_url) {
            const imgErr = validateImage(icon_url);
            if (imgErr) return res.status(400).json({ message: "Icon: " + imgErr });
        }

        const slug = slugify(name);
        const exists = await db.query(
            "SELECT id FROM categories WHERE slug=$1 OR LOWER(name)=LOWER($2)",
            [slug, name.trim()]
        );
        if (exists.rows.length)
            return res.status(409).json({ message: "Category already exists" });

        const { rows } = await db.query(
            `INSERT INTO categories (name, slug, icon, icon_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
            [name.trim(), slug, icon || "🍽️", icon_url || null]
        );

        res.status(201).json({ category: { ...rows[0], product_count: 0 } });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/admin/categories/:id
exports.updateCategory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, icon, icon_url } = req.body;

        if (name !== undefined) {
            const nameErr = validateCategoryName(name);
            if (nameErr) return res.status(400).json({ message: nameErr });
        }
        if (icon !== undefined) {
            const iconErr = validateCategoryIcon(icon);
            if (iconErr) return res.status(400).json({ message: iconErr });
        }
        if (icon_url) {
            const imgErr = validateImage(icon_url);
            if (imgErr) return res.status(400).json({ message: "Icon: " + imgErr });
        }

        const updates = [];
        const values = [];
        let i = 1;

        if (name !== undefined) {
            updates.push(`name=$${i++}`);
            values.push(name.trim());
            updates.push(`slug=$${i++}`);
            values.push(slugify(name));
        }
        if (icon !== undefined) {
            updates.push(`icon=$${i++}`);
            values.push(icon);
        }
        if (icon_url !== undefined) {
            updates.push(`icon_url=$${i++}`);
            values.push(icon_url || null);
        }

        if (!updates.length)
            return res.status(400).json({ message: "Nothing to update" });

        values.push(id);
        const { rows } = await db.query(
            `UPDATE categories SET ${updates.join(", ")}
       WHERE id=$${i}
       RETURNING *`,
            values
        );

        if (!rows.length) return res.status(404).json({ message: "Category not found" });

        res.json({ category: rows[0] });
    } catch (err) {
        if (err.code === "23505")
            return res.status(409).json({ message: "Category name already exists" });
        next(err);
    }
};

// DELETE /api/admin/categories/:id
exports.deleteCategory = async (req, res, next) => {
    try {
        const { id } = req.params;

        const inUse = await db.query(
            "SELECT COUNT(*)::int AS n FROM products WHERE category_id=$1",
            [id]
        );
        if (inUse.rows[0].n > 0)
            return res.status(400).json({
                message: `Cannot delete — ${inUse.rows[0].n} product(s) still use this category`,
            });

        const { rowCount } = await db.query(
            "DELETE FROM categories WHERE id=$1",
            [id]
        );
        if (!rowCount) return res.status(404).json({ message: "Category not found" });

        res.json({ message: "Category deleted" });
    } catch (err) {
        next(err);
    }
};