const db = require("../config/db");
const {
    validateProductName,
    validateDescription,
    validatePrice,
    validateOldPrice,
    validateRating,
    validateImage,
    validateCalories,
    validateReviews,
} = require("../utils/validators");

const slugify = (s) =>
    s
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 140);

// ─────────────────────────────────────────────
// Fetch variants for a set of product ids
// ─────────────────────────────────────────────
async function attachVariants(products) {
    if (!products.length) return products;
    const ids = products.map((p) => p.id);
    const { rows } = await db.query(
        `SELECT id, product_id, label, price, is_default, sort_order
     FROM product_variants
     WHERE product_id = ANY($1::int[])
     ORDER BY sort_order, id`,
        [ids]
    );
    const byProduct = {};
    for (const v of rows) {
        if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
        byProduct[v.product_id].push(v);
    }
    return products.map((p) => ({ ...p, variants: byProduct[p.id] || [] }));
}

// ─────────────────────────────────────────────
// Insert / replace variants for a product
// ─────────────────────────────────────────────
async function replaceVariants(productId, variants) {
    if (!Array.isArray(variants)) return;

    await db.query("DELETE FROM product_variants WHERE product_id=$1", [
        productId,
    ]);

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v || !v.label || !String(v.label).trim()) continue;
        const price = Number(v.price);
        if (!Number.isFinite(price) || price < 0) continue;

        await db.query(
            `INSERT INTO product_variants (product_id, label, price, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
            [productId, String(v.label).trim().slice(0, 60), price, !!v.is_default, i]
        );
    }
}

// ─────────────────────────────────────────────
// Validate delivery_fee + tax_percent
// ─────────────────────────────────────────────
function validateDeliveryFee(v) {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return "Delivery fee must be a number";
    if (n < 0) return "Delivery fee cannot be negative";
    if (n > 100000) return "Delivery fee is too high";
    return null;
}

function validateTaxPercent(v) {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return "Tax percent must be a number";
    if (n < 0 || n > 100) return "Tax percent must be between 0 and 100";
    return null;
}

// ─────────────────────────────────────────────
// GET /api/products?category=&search=&veg=&max=&sort=
// ─────────────────────────────────────────────
exports.listProducts = async (req, res, next) => {
    try {
        const { category, search, veg, max, sort } = req.query;

        const where = [];
        const params = [];
        let i = 1;

        if (category && category !== "all") {
            where.push(`c.slug = $${i++}`);
            params.push(category);
        }
        if (search) {
            where.push(`(p.name ILIKE $${i} OR p.description ILIKE $${i})`);
            params.push(`%${search}%`);
            i++;
        }
        if (veg === "true") {
            where.push(`p.veg = TRUE`);
        }
        if (max) {
            where.push(`p.price <= $${i++}`);
            params.push(Number(max));
        }

        const sortSql =
            sort === "price-low"
                ? "p.price ASC"
                : sort === "price-high"
                    ? "p.price DESC"
                    : sort === "rating"
                        ? "p.rating DESC"
                        : "p.popular DESC, p.rating DESC";

        const { rows } = await db.query(
            `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              c.icon AS category_icon, c.icon_url AS category_icon_url
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY ${sortSql}`,
            params
        );

        const withVariants = await attachVariants(rows);
        res.json({ products: withVariants });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/products/:id
// ─────────────────────────────────────────────
exports.getProduct = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              c.icon AS category_icon, c.icon_url AS category_icon_url
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.id=$1`,
            [req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Product not found" });

        const [product] = await attachVariants(rows);
        res.json({ product });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// POST /api/admin/products
// ─────────────────────────────────────────────
exports.createProduct = async (req, res, next) => {
    try {
        const b = req.body;

        // ── Validate ──
        const errors = [];
        const nameErr = validateProductName(b.name);
        if (nameErr) errors.push(nameErr);
        const descErr = validateDescription(b.description);
        if (descErr) errors.push(descErr);
        const longErr = validateDescription(b.long_desc);
        if (longErr) errors.push("Long description: " + longErr);
        const priceErr = validatePrice(b.price);
        if (priceErr) errors.push(priceErr);
        const oldErr = validateOldPrice(b.price, b.old_price);
        if (oldErr) errors.push(oldErr);
        const ratingErr = validateRating(b.rating ?? 5);
        if (ratingErr) errors.push(ratingErr);
        const reviewsErr = validateReviews(b.reviews ?? 0);
        if (reviewsErr) errors.push(reviewsErr);
        const imgErr = validateImage(b.img);
        if (imgErr) errors.push(imgErr);
        const calErr = validateCalories(b.calories ?? 0);
        if (calErr) errors.push(calErr);

        // ── NEW: delivery_fee + tax_percent ──
        const dfErr = validateDeliveryFee(b.delivery_fee);
        if (dfErr) errors.push(dfErr);
        const tpErr = validateTaxPercent(b.tax_percent);
        if (tpErr) errors.push(tpErr);

        if (!b.category_id) errors.push("Category is required");

        if (errors.length)
            return res.status(400).json({ message: errors[0], errors });

        // Category exists?
        const cat = await db.query("SELECT id FROM categories WHERE id=$1", [
            b.category_id,
        ]);
        if (!cat.rows.length)
            return res.status(400).json({ message: "Category not found" });

        // Unique slug
        let slug = slugify(b.name);
        const dupe = await db.query("SELECT id FROM products WHERE slug=$1", [slug]);
        if (dupe.rows.length) slug = `${slug}-${Date.now()}`;

        // Defaults for the new fields
        const deliveryFee =
            b.delivery_fee !== undefined && b.delivery_fee !== null && b.delivery_fee !== ""
                ? Number(b.delivery_fee)
                : 199;
        const taxPercent =
            b.tax_percent !== undefined && b.tax_percent !== null && b.tax_percent !== ""
                ? Number(b.tax_percent)
                : 5;

        const { rows } = await db.query(
            `INSERT INTO products
       (name, slug, description, long_desc, price, old_price, category_id,
        img, rating, reviews, time, calories, serves, ingredients,
        veg, spicy, popular, available, delivery_fee, tax_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
            [
                b.name.trim(),
                slug,
                b.description || "",
                b.long_desc || "",
                Number(b.price),
                b.old_price ? Number(b.old_price) : null,
                Number(b.category_id),
                b.img,
                Number(b.rating ?? 5),
                Number(b.reviews ?? 0),
                b.time || "25 min",
                Number(b.calories ?? 0),
                b.serves || "1 person",
                b.ingredients || [],
                !!b.veg,
                !!b.spicy,
                !!b.popular,
                b.available !== false,
                deliveryFee,
                taxPercent,
            ]
        );

        // Insert variants (if any)
        await replaceVariants(rows[0].id, b.variants);

        // Re-fetch with variants attached
        const [withVariants] = await attachVariants(rows);
        res.status(201).json({ product: withVariants });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/products/:id
// ─────────────────────────────────────────────
exports.updateProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const b = req.body;

        const errors = [];
        if (b.name !== undefined) {
            const e = validateProductName(b.name);
            if (e) errors.push(e);
        }
        if (b.price !== undefined) {
            const e = validatePrice(b.price);
            if (e) errors.push(e);
        }
        if (
            b.old_price !== undefined &&
            b.old_price !== null &&
            b.old_price !== ""
        ) {
            const e = validateOldPrice(b.price, b.old_price);
            if (e) errors.push(e);
        }
        if (b.rating !== undefined) {
            const e = validateRating(b.rating);
            if (e) errors.push(e);
        }
        if (b.img !== undefined) {
            const e = validateImage(b.img);
            if (e) errors.push(e);
        }
        if (b.description !== undefined) {
            const e = validateDescription(b.description);
            if (e) errors.push(e);
        }

        // ── NEW: validate delivery_fee + tax_percent ──
        if (b.delivery_fee !== undefined) {
            const e = validateDeliveryFee(b.delivery_fee);
            if (e) errors.push(e);
        }
        if (b.tax_percent !== undefined) {
            const e = validateTaxPercent(b.tax_percent);
            if (e) errors.push(e);
        }

        if (errors.length)
            return res.status(400).json({ message: errors[0], errors });

        const allowed = [
            "name",
            "description",
            "long_desc",
            "price",
            "old_price",
            "category_id",
            "img",
            "rating",
            "reviews",
            "time",
            "calories",
            "serves",
            "ingredients",
            "veg",
            "spicy",
            "popular",
            "available",
            "delivery_fee",   // ← NEW
            "tax_percent",    // ← NEW
        ];

        const updates = [];
        const values = [];
        let i = 1;

        for (const key of allowed) {
            if (b[key] !== undefined) {
                updates.push(`${key}=$${i++}`);
                // Coerce empty strings to null for nullable fields
                if (
                    (key === "delivery_fee" || key === "tax_percent") &&
                    (b[key] === "" || b[key] === null)
                ) {
                    values.push(null);
                } else {
                    values.push(b[key]);
                }
            }
        }

        // Refresh slug if name changed
        if (b.name) {
            let slug = slugify(b.name);
            const dupe = await db.query(
                "SELECT id FROM products WHERE slug=$1 AND id<>$2",
                [slug, id]
            );
            if (dupe.rows.length) slug = `${slug}-${Date.now()}`;
            updates.push(`slug=$${i++}`);
            values.push(slug);
        }

        // Allow variants-only updates (no product fields changed)
        if (!updates.length && b.variants === undefined) {
            return res.status(400).json({ message: "Nothing to update" });
        }

        let productRow = null;

        if (updates.length) {
            values.push(id);
            const { rows } = await db.query(
                `UPDATE products SET ${updates.join(", ")}
         WHERE id=$${i}
         RETURNING *`,
                values
            );
            if (!rows.length)
                return res.status(404).json({ message: "Product not found" });
            productRow = rows[0];
        } else {
            // Nothing to update on products — just verify existence
            const { rows } = await db.query("SELECT * FROM products WHERE id=$1", [id]);
            if (!rows.length)
                return res.status(404).json({ message: "Product not found" });
            productRow = rows[0];
        }

        // Replace variants if provided
        if (b.variants !== undefined) {
            await replaceVariants(id, b.variants);
        }

        // Return fresh row with variants
        const [withVariants] = await attachVariants([productRow]);
        res.json({ product: withVariants });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// DELETE /api/admin/products/:id
// ─────────────────────────────────────────────
exports.deleteProduct = async (req, res, next) => {
    try {
        // Variants are removed automatically by ON DELETE CASCADE
        const { rowCount } = await db.query("DELETE FROM products WHERE id=$1", [
            req.params.id,
        ]);
        if (!rowCount)
            return res.status(404).json({ message: "Product not found" });
        res.json({ message: "Product deleted" });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/products/:id/toggle
// ─────────────────────────────────────────────
exports.toggleAvailable = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `UPDATE products SET available = NOT available
       WHERE id=$1 RETURNING id, available`,
            [req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Product not found" });
        res.json({ product: rows[0] });
    } catch (err) {
        next(err);
    }
};