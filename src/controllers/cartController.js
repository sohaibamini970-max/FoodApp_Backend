const db = require("../config/db");

// ─────────────────────────────────────────────
// Get or create the active cart for the current caller
// ─────────────────────────────────────────────
async function getOrCreateCart(req) {
    const userId = req.user?.id || null;
    const sessionId = req.headers["x-cart-session"] || null;

    if (!userId && !sessionId) {
        throw new Error("NO_SESSION");
    }

    const lookup = userId
        ? await db.query(
            "SELECT * FROM carts WHERE user_id=$1 AND status='active' LIMIT 1",
            [userId]
        )
        : await db.query(
            "SELECT * FROM carts WHERE session_id=$1 AND status='active' LIMIT 1",
            [sessionId]
        );

    if (lookup.rows.length) return lookup.rows[0];

    const inserted = await db.query(
        `INSERT INTO carts (user_id, session_id, status)
     VALUES ($1, $2, 'active')
     RETURNING *`,
        [userId, userId ? null : sessionId]
    );
    return inserted.rows[0];
}

// ─────────────────────────────────────────────
// Load a cart with all items (products + deals)
// ─────────────────────────────────────────────
async function loadCart(cartId) {
    const { rows: cartRows } = await db.query(
        "SELECT * FROM carts WHERE id=$1",
        [cartId]
    );
    if (!cartRows.length) return null;

    const { rows: rawItems } = await db.query(
        `SELECT
       ci.id, ci.product_id, ci.deal_id, ci.variant_id,
       ci.quantity, ci.unit_price,
       ci.product_name, ci.variant_label, ci.img,
       p.time AS product_time,
       p.delivery_fee AS product_delivery_fee,
       p.tax_percent AS product_tax_percent,
       d.delivery_fee AS deal_delivery_fee,
       d.tax_percent AS deal_tax_percent,
       d.ends_in AS deal_ends_in,
       COALESCE(p.time, '30 min') AS time,
       c.name AS category_name, c.slug AS category_slug
     FROM cart_items ci
     LEFT JOIN products p ON p.id = ci.product_id
     LEFT JOIN deals d ON d.id = ci.deal_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ci.cart_id=$1
     ORDER BY ci.created_at ASC`,
        [cartId]
    );

    // Normalize each row so downstream code has a single
    // delivery_fee / tax_percent to work with
    const items = rawItems.map((i) => ({
        id: i.id,
        product_id: i.product_id,
        deal_id: i.deal_id,
        variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        product_name: i.product_name,
        variant_label: i.variant_label,
        img: i.img,
        time: i.time,
        category_name: i.category_name,
        category_slug: i.deal_id ? "deals" : i.category_slug,
        delivery_fee: i.deal_id
            ? Number(i.deal_delivery_fee) || 0
            : Number(i.product_delivery_fee) || 0,
        tax_percent: i.deal_id
            ? Number(i.deal_tax_percent) || 0
            : Number(i.product_tax_percent) || 0,
    }));

    const subtotal = items.reduce(
        (s, i) => s + i.unit_price * i.quantity,
        0
    );
    const totalItems = items.reduce((s, i) => s + i.quantity, 0);

    // Delivery: highest fee across items (one delivery trip)
    const deliveryFee =
        items.length === 0
            ? 0
            : Math.max(0, ...items.map((i) => i.delivery_fee || 0));

    // Tax: sum of (line_total × tax_percent / 100) per item
    const tax = Math.round(
        items.reduce(
            (sum, i) => sum + (i.unit_price * i.quantity * (i.tax_percent || 0)) / 100,
            0
        )
    );

    const total = subtotal + deliveryFee + tax;

    return {
        id: cartRows[0].id,
        items,
        subtotal,
        totalItems,
        deliveryFee,
        tax,
        total,
    };
}

// ─────────────────────────────────────────────
// GET /api/cart
// ─────────────────────────────────────────────
exports.getCart = async (req, res, next) => {
    try {
        const sessionId = req.headers["x-cart-session"] || null;
        const userId = req.user?.id || null;

        if (!userId && !sessionId) {
            return res.json({
                cart: {
                    id: null,
                    items: [],
                    subtotal: 0,
                    totalItems: 0,
                    deliveryFee: 0,
                    tax: 0,
                    total: 0,
                },
            });
        }

        const cart = await getOrCreateCart(req);
        const full = await loadCart(cart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};

// ─────────────────────────────────────────────
// POST /api/cart/items
// Body: { product_id, variant_id?, quantity? } OR { deal_id, quantity? }
// ─────────────────────────────────────────────
exports.addItem = async (req, res, next) => {
    try {
        const { product_id, deal_id, variant_id, quantity = 1 } = req.body;

        if (!product_id && !deal_id) {
            return res
                .status(400)
                .json({ message: "product_id or deal_id is required" });
        }
        if (product_id && deal_id) {
            return res
                .status(400)
                .json({ message: "Provide only one of product_id or deal_id" });
        }

        const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

        /* ════════════ DEAL BRANCH ════════════ */
        if (deal_id) {
            const { rows: dealRows } = await db.query(
                "SELECT id, title, deal_price, img, active FROM deals WHERE id=$1",
                [deal_id]
            );
            if (!dealRows.length)
                return res.status(404).json({ message: "Deal not found" });
            const deal = dealRows[0];
            if (!deal.active)
                return res
                    .status(400)
                    .json({ message: "Deal is currently unavailable" });

            const cart = await getOrCreateCart(req);

            const existing = await db.query(
                "SELECT id FROM cart_items WHERE cart_id=$1 AND deal_id=$2",
                [cart.id, deal_id]
            );

            if (existing.rows.length) {
                await db.query(
                    `UPDATE cart_items SET quantity = quantity + $1, unit_price=$2
           WHERE id=$3`,
                    [qty, Number(deal.deal_price), existing.rows[0].id]
                );
            } else {
                await db.query(
                    `INSERT INTO cart_items
           (cart_id, deal_id, quantity, unit_price, product_name, img)
           VALUES ($1,$2,$3,$4,$5,$6)`,
                    [cart.id, deal_id, qty, Number(deal.deal_price), deal.title, deal.img]
                );
            }

            const full = await loadCart(cart.id);
            return res.json({ cart: full });
        }

        /* ════════════ PRODUCT BRANCH ════════════ */
        const { rows: prodRows } = await db.query(
            "SELECT id, name, price, img, available FROM products WHERE id=$1",
            [product_id]
        );
        if (!prodRows.length)
            return res.status(404).json({ message: "Product not found" });
        const product = prodRows[0];
        if (!product.available)
            return res
                .status(400)
                .json({ message: "Product is currently unavailable" });

        let unitPrice = Number(product.price);
        let variantLabel = null;

        if (variant_id) {
            const { rows: varRows } = await db.query(
                "SELECT id, label, price FROM product_variants WHERE id=$1 AND product_id=$2",
                [variant_id, product_id]
            );
            if (!varRows.length)
                return res.status(400).json({ message: "Invalid variant" });
            unitPrice = Number(varRows[0].price);
            variantLabel = varRows[0].label;
        } else {
            const { rows: anyVars } = await db.query(
                "SELECT id FROM product_variants WHERE product_id=$1 LIMIT 1",
                [product_id]
            );
            if (anyVars.length) {
                return res
                    .status(400)
                    .json({ message: "Please select a variant first" });
            }
        }

        const cart = await getOrCreateCart(req);

        const existing = await db.query(
            `SELECT id FROM cart_items
       WHERE cart_id=$1 AND product_id=$2 AND deal_id IS NULL
       AND COALESCE(variant_id,0) = COALESCE($3,0)`,
            [cart.id, product_id, variant_id || null]
        );

        if (existing.rows.length) {
            await db.query(
                `UPDATE cart_items SET quantity = quantity + $1, unit_price=$2
         WHERE id=$3`,
                [qty, unitPrice, existing.rows[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO cart_items
         (cart_id, product_id, variant_id, quantity, unit_price,
          product_name, variant_label, img)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    cart.id,
                    product_id,
                    variant_id || null,
                    qty,
                    unitPrice,
                    product.name,
                    variantLabel,
                    product.img,
                ]
            );
        }

        const full = await loadCart(cart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/cart/items/:id  { quantity }
// ─────────────────────────────────────────────
exports.updateItem = async (req, res, next) => {
    try {
        const itemId = Number(req.params.id);
        const qty = Number(req.body.quantity);

        if (!Number.isFinite(qty)) {
            return res.status(400).json({ message: "quantity is required" });
        }

        const cart = await getOrCreateCart(req);

        const { rows } = await db.query(
            "SELECT id FROM cart_items WHERE id=$1 AND cart_id=$2",
            [itemId, cart.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Item not found in cart" });

        if (qty <= 0) {
            await db.query("DELETE FROM cart_items WHERE id=$1", [itemId]);
        } else {
            await db.query("UPDATE cart_items SET quantity=$1 WHERE id=$2", [
                Math.min(99, qty),
                itemId,
            ]);
        }

        const full = await loadCart(cart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};

// ─────────────────────────────────────────────
// DELETE /api/cart/items/:id
// ─────────────────────────────────────────────
exports.removeItem = async (req, res, next) => {
    try {
        const itemId = Number(req.params.id);
        const cart = await getOrCreateCart(req);

        const { rowCount } = await db.query(
            "DELETE FROM cart_items WHERE id=$1 AND cart_id=$2",
            [itemId, cart.id]
        );
        if (!rowCount)
            return res.status(404).json({ message: "Item not found in cart" });

        const full = await loadCart(cart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};

// ─────────────────────────────────────────────
// DELETE /api/cart
// ─────────────────────────────────────────────
exports.clearCart = async (req, res, next) => {
    try {
        const cart = await getOrCreateCart(req);
        await db.query("DELETE FROM cart_items WHERE cart_id=$1", [cart.id]);
        const full = await loadCart(cart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};

// ─────────────────────────────────────────────
// POST /api/cart/merge  (called after login)
// ─────────────────────────────────────────────
exports.mergeGuestCart = async (req, res, next) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        const sessionId = req.headers["x-cart-session"];
        if (!sessionId) return res.json({ cart: null });

        const { rows: guestRows } = await db.query(
            "SELECT * FROM carts WHERE session_id=$1 AND status='active' LIMIT 1",
            [sessionId]
        );
        if (!guestRows.length) {
            const cart = await getOrCreateCart(req);
            return res.json({ cart: await loadCart(cart.id) });
        }

        const guestCart = guestRows[0];
        const userCart = await getOrCreateCart(req);

        const { rows: guestItems } = await db.query(
            "SELECT * FROM cart_items WHERE cart_id=$1",
            [guestCart.id]
        );

        for (const gi of guestItems) {
            // Match on product+deal+variant together
            const existing = await db.query(
                `SELECT id FROM cart_items
         WHERE cart_id=$1
           AND product_id IS NOT DISTINCT FROM $2
           AND deal_id IS NOT DISTINCT FROM $3
           AND COALESCE(variant_id,0)=COALESCE($4,0)`,
                [userCart.id, gi.product_id, gi.deal_id, gi.variant_id]
            );

            if (existing.rows.length) {
                await db.query(
                    "UPDATE cart_items SET quantity = quantity + $1 WHERE id=$2",
                    [gi.quantity, existing.rows[0].id]
                );
            } else {
                await db.query(
                    `INSERT INTO cart_items
           (cart_id, product_id, deal_id, variant_id, quantity, unit_price,
            product_name, variant_label, img)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [
                        userCart.id,
                        gi.product_id,
                        gi.deal_id,
                        gi.variant_id,
                        gi.quantity,
                        gi.unit_price,
                        gi.product_name,
                        gi.variant_label,
                        gi.img,
                    ]
                );
            }
        }

        await db.query("UPDATE carts SET status='converted' WHERE id=$1", [
            guestCart.id,
        ]);

        const full = await loadCart(userCart.id);
        res.json({ cart: full });
    } catch (err) {
        if (err.message === "NO_SESSION") {
            return res.status(400).json({ message: "Missing cart session" });
        }
        next(err);
    }
};