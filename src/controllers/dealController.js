const db = require("../config/db");

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function validateDealFields(b) {
    const errors = [];
    if (!b.title || !String(b.title).trim()) errors.push("Title is required");
    if (!b.img || !String(b.img).trim()) errors.push("Image is required");
    if (!Array.isArray(b.items) || b.items.length === 0)
        errors.push("At least one product is required");

    const dp = Number(b.deal_price);
    if (!Number.isFinite(dp) || dp < 0) errors.push("Deal price must be >= 0");

    const df = b.delivery_fee !== undefined ? Number(b.delivery_fee) : 199;
    if (!Number.isFinite(df) || df < 0) errors.push("Delivery fee must be >= 0");

    const tp = b.tax_percent !== undefined ? Number(b.tax_percent) : 5;
    if (!Number.isFinite(tp) || tp < 0 || tp > 100)
        errors.push("Tax percent must be 0-100");

    return errors;
}

async function fetchDealItems(dealId) {
    const { rows } = await db.query(
        `SELECT di.id, di.product_id, di.variant_id, di.quantity, di.sort_order,
            p.name AS product_name, p.price AS product_price,
            p.img AS product_img, p.available AS product_available,
            v.label AS variant_label, v.price AS variant_price
     FROM deal_items di
     JOIN products p ON p.id = di.product_id
     LEFT JOIN product_variants v ON v.id = di.variant_id
     WHERE di.deal_id=$1
     ORDER BY di.sort_order, di.id`,
        [dealId]
    );
    return rows;
}

async function attachItemsToDeals(deals) {
    if (!deals.length) return deals;
    const ids = deals.map((d) => d.id);
    const { rows } = await db.query(
        `SELECT di.deal_id, di.product_id, di.variant_id, di.quantity,
            p.name AS product_name, p.price AS product_price,
            p.img AS product_img,
            v.label AS variant_label, v.price AS variant_price
     FROM deal_items di
     JOIN products p ON p.id = di.product_id
     LEFT JOIN product_variants v ON v.id = di.variant_id
     WHERE di.deal_id = ANY($1::int[])
     ORDER BY di.sort_order, di.id`,
        [ids]
    );
    const byDeal = {};
    for (const it of rows) {
        if (!byDeal[it.deal_id]) byDeal[it.deal_id] = [];
        byDeal[it.deal_id].push(it);
    }
    return deals.map((d) => ({ ...d, items: byDeal[d.id] || [] }));
}

async function computeBasePrice(items) {
    if (!items.length) return 0;

    let total = 0;
    for (const it of items) {
        const qty = Number(it.quantity) || 1;
        const productId = Number(it.product_id);

        if (it.variant_id) {
            const { rows } = await db.query(
                "SELECT price FROM product_variants WHERE id=$1 AND product_id=$2",
                [it.variant_id, productId]
            );
            if (rows.length) {
                total += Number(rows[0].price) * qty;
                continue;
            }
        }

        const { rows } = await db.query(
            "SELECT price FROM products WHERE id=$1",
            [productId]
        );
        if (rows.length) total += Number(rows[0].price) * qty;
    }
    return total;
}

// ─────────────────────────────────────────────
// GET /api/deals  (public — only active)
// ─────────────────────────────────────────────
exports.listDeals = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT * FROM deals WHERE active=TRUE ORDER BY created_at DESC`
        );
        const withItems = await attachItemsToDeals(rows);
        res.json({ deals: withItems });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/admin/deals  (admin — all)
// ─────────────────────────────────────────────
exports.adminListDeals = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT * FROM deals ORDER BY created_at DESC`
        );
        const withItems = await attachItemsToDeals(rows);
        res.json({ deals: withItems });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/deals/:id  (public — active only)
// ─────────────────────────────────────────────
exports.getDeal = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            "SELECT * FROM deals WHERE id=$1 AND active=TRUE",
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ message: "Deal not found" });
        const withItems = await attachItemsToDeals(rows);
        res.json({ deal: withItems[0] });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// POST /api/admin/deals
// ─────────────────────────────────────────────
exports.createDeal = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const b = req.body;

        const errors = validateDealFields(b);
        if (errors.length)
            return res.status(400).json({ message: errors[0], errors });

        const basePrice = await computeBasePrice(b.items);
        if (basePrice === 0)
            return res.status(400).json({ message: "Invalid product selection" });

        await client.query("BEGIN");

        const { rows: dealRows } = await client.query(
            `INSERT INTO deals
       (title, subtitle, description, img, badge, tag_color, ends_in, category,
        base_price, deal_price, delivery_fee, tax_percent, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
            [
                b.title.trim(),
                b.subtitle?.trim() || "",
                b.description?.trim() || "",
                b.img,
                b.badge?.trim() || "",
                b.tag_color || "from-orange-500 to-red-500",
                b.ends_in || "2 days",
                b.category || "Combo",
                basePrice,
                Number(b.deal_price),
                b.delivery_fee !== undefined ? Number(b.delivery_fee) : 199,
                b.tax_percent !== undefined ? Number(b.tax_percent) : 5,
                b.active !== false,
            ]
        );

        const deal = dealRows[0];

        // Insert deal items WITH variant_id
        for (let i = 0; i < b.items.length; i++) {
            const it = b.items[i];
            if (!it.product_id) continue;

            await client.query(
                `INSERT INTO deal_items
           (deal_id, product_id, variant_id, quantity, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
                [
                    deal.id,
                    Number(it.product_id),
                    it.variant_id ? Number(it.variant_id) : null,
                    Number(it.quantity) || 1,
                    i,
                ]
            );
        }

        await client.query("COMMIT");

        const items = await fetchDealItems(deal.id);
        res.status(201).json({ deal: { ...deal, items } });
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch { }
        next(err);
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/deals/:id
// ─────────────────────────────────────────────
exports.updateDeal = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { id } = req.params;
        const b = req.body;

        // Verify exists
        const exists = await client.query("SELECT * FROM deals WHERE id=$1", [id]);
        if (!exists.rows.length)
            return res.status(404).json({ message: "Deal not found" });

        const existing = exists.rows[0];

        // Validate — merge existing with incoming
        const mergedForValidation = {
            title: b.title !== undefined ? b.title : existing.title,
            img: b.img !== undefined ? b.img : existing.img,
            deal_price:
                b.deal_price !== undefined ? b.deal_price : existing.deal_price,
            delivery_fee:
                b.delivery_fee !== undefined
                    ? b.delivery_fee
                    : existing.delivery_fee,
            tax_percent:
                b.tax_percent !== undefined ? b.tax_percent : existing.tax_percent,
            // Only validate items if provided; otherwise use a fake non-empty array
            items:
                b.items !== undefined
                    ? b.items
                    : [{ product_id: 1, quantity: 1 }],
        };

        const errors = validateDealFields(mergedForValidation);
        if (errors.length)
            return res.status(400).json({ message: errors[0], errors });

        await client.query("BEGIN");

        // Recompute base price if items changed
        let basePrice = Number(existing.base_price);
        if (Array.isArray(b.items)) {
            basePrice = await computeBasePrice(b.items);
        }

        const allowed = [
            "title",
            "subtitle",
            "description",
            "img",
            "badge",
            "tag_color",
            "ends_in",
            "category",
            "deal_price",
            "delivery_fee",
            "tax_percent",
            "active",
        ];

        const updates = [];
        const values = [];
        let idx = 1;

        for (const key of allowed) {
            if (b[key] !== undefined) {
                updates.push(`${key}=$${idx++}`);
                values.push(b[key]);
            }
        }

        // Always update base_price
        updates.push(`base_price=$${idx++}`);
        values.push(basePrice);

        values.push(id);
        const { rows: updated } = await client.query(
            `UPDATE deals SET ${updates.join(", ")} WHERE id=$${idx} RETURNING *`,
            values
        );

        // Replace items if provided
        if (Array.isArray(b.items)) {
            await client.query("DELETE FROM deal_items WHERE deal_id=$1", [id]);
            for (let i = 0; i < b.items.length; i++) {
                const it = b.items[i];
                if (!it.product_id) continue;

                await client.query(
                    `INSERT INTO deal_items
             (deal_id, product_id, variant_id, quantity, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
                    [
                        id,
                        Number(it.product_id),
                        it.variant_id ? Number(it.variant_id) : null,
                        Number(it.quantity) || 1,
                        i,
                    ]
                );
            }
        }

        await client.query("COMMIT");

        const items = await fetchDealItems(id);
        res.json({ deal: { ...updated[0], items } });
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch { }
        next(err);
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────
// DELETE /api/admin/deals/:id
// ─────────────────────────────────────────────
exports.deleteDeal = async (req, res, next) => {
    try {
        // Remove from any active carts first
        await db.query("DELETE FROM cart_items WHERE deal_id=$1", [req.params.id]);

        const { rowCount } = await db.query("DELETE FROM deals WHERE id=$1", [
            req.params.id,
        ]);
        if (!rowCount) return res.status(404).json({ message: "Deal not found" });
        res.json({ message: "Deal deleted" });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/deals/:id/toggle
// ─────────────────────────────────────────────
exports.toggleDeal = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `UPDATE deals SET active = NOT active WHERE id=$1
       RETURNING id, active`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ message: "Deal not found" });
        res.json({ deal: rows[0] });
    } catch (err) {
        next(err);
    }
};