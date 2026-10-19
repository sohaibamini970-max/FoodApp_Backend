const db = require("../config/db");
const crypto = require("crypto");

const generateToken = () =>
    "ord_" + crypto.randomBytes(20).toString("hex");

// ─────────────────────────────────────────────
// Find the active cart for this caller
// ─────────────────────────────────────────────
async function findActiveCart(userId, sessionId) {
    if (userId) {
        const { rows } = await db.query(
            "SELECT * FROM carts WHERE user_id=$1 AND status='active' LIMIT 1",
            [userId]
        );
        return rows[0] || null;
    }
    if (sessionId) {
        const { rows } = await db.query(
            "SELECT * FROM carts WHERE session_id=$1 AND status='active' LIMIT 1",
            [sessionId]
        );
        return rows[0] || null;
    }
    return null;
}

// ─────────────────────────────────────────────
// POST /api/orders/checkout
// ─────────────────────────────────────────────
exports.checkout = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const {
            customer_name,
            customer_email,
            customer_phone,
            delivery_address,
            delivery_city,
            delivery_notes,
            promo_code,
            payment_method = "cod",
            payment_txn_id,
        } = req.body;

        // ── Validation ──
        if (!customer_name?.trim()) throw new Error("Name is required");
        if (!customer_phone?.trim() || customer_phone.trim().length < 10)
            throw new Error("Valid phone number is required");
        if (!delivery_address?.trim())
            throw new Error("Delivery address is required");
        if (!delivery_city?.trim()) throw new Error("City is required");
        if (
            (payment_method === "jazzcash" || payment_method === "easypaisa") &&
            !payment_txn_id?.trim()
        )
            throw new Error("Transaction ID is required for manual payment");

        const userId = req.user?.id || null;
        const sessionId = req.headers["x-cart-session"] || null;

        if (!userId && !sessionId)
            throw new Error("No cart session — please add items first");

        // ── Load cart ──
        const cart = await findActiveCart(userId, sessionId);
        if (!cart) throw new Error("Cart not found or empty");

        const { rows: cartItems } = await client.query(
            "SELECT * FROM cart_items WHERE cart_id=$1",
            [cart.id]
        );
        if (!cartItems.length) throw new Error("Cart is empty");

        // ── Compute totals from products/deals ──
        const { rows: productRows } = await client.query(
            `SELECT id, delivery_fee, tax_percent FROM products
       WHERE id = ANY($1::int[])`,
            [cartItems.filter(i => i.product_id).map(i => i.product_id)]
        );
        const { rows: dealRows } = await client.query(
            `SELECT id, delivery_fee, tax_percent FROM deals
       WHERE id = ANY($1::int[])`,
            [cartItems.filter(i => i.deal_id).map(i => i.deal_id)]
        );

        const pFee = Object.fromEntries(productRows.map(p => [p.id, p]));
        const dFee = Object.fromEntries(dealRows.map(d => [d.id, d]));

        const subtotal = cartItems.reduce(
            (s, i) => s + Number(i.unit_price) * i.quantity, 0
        );

        const deliveryFee = Math.max(
            0,
            ...cartItems.map((i) => {
                if (i.deal_id) return Number(dFee[i.deal_id]?.delivery_fee) || 0;
                return Number(pFee[i.product_id]?.delivery_fee) || 0;
            })
        );

        const tax = Math.round(
            cartItems.reduce((sum, i) => {
                const tp = i.deal_id
                    ? Number(dFee[i.deal_id]?.tax_percent) || 0
                    : Number(pFee[i.product_id]?.tax_percent) || 0;
                return sum + (Number(i.unit_price) * i.quantity * tp) / 100;
            }, 0)
        );

        let discount = 0;
        if (promo_code && promo_code.toUpperCase() === "FOODIE10") {
            discount = Math.round(subtotal * 0.1);
        }

        const total = Math.max(0, subtotal + deliveryFee + tax - discount);

        // ── Transaction ──
        await client.query("BEGIN");

        const orderToken = generateToken();

        const { rows: orderRows } = await client.query(
            `INSERT INTO orders
       (order_token, user_id, session_id,
        customer_name, customer_email, customer_phone,
        delivery_address, delivery_city, delivery_notes,
        subtotal, delivery_fee, tax, discount, total,
        status, payment_method, payment_status, payment_txn_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               'pending', $15, 'unpaid', $16)
       RETURNING *`,
            [
                orderToken,
                userId,
                userId ? null : sessionId,
                customer_name.trim(),
                customer_email?.trim() || null,
                customer_phone.trim(),
                delivery_address.trim(),
                delivery_city.trim(),
                delivery_notes?.trim() || null,
                subtotal,
                deliveryFee,
                tax,
                discount,
                total,
                payment_method,
                payment_txn_id?.trim() || null,
            ]
        );

        const order = orderRows[0];

        // Insert order items
        for (const item of cartItems) {
            const lineTotal = Number(item.unit_price) * item.quantity;

            // For deal items, snapshot the deal's sub-items
            let dealSnapshot = null;
            if (item.deal_id) {
                const { rows: subs } = await client.query(
                    `SELECT di.product_id, di.variant_id, di.quantity,
                  p.name AS product_name, v.label AS variant_label,
                  COALESCE(v.price, p.price) AS unit_price, p.img
           FROM deal_items di
           JOIN products p ON p.id = di.product_id
           LEFT JOIN product_variants v ON v.id = di.variant_id
           WHERE di.deal_id=$1`,
                    [item.deal_id]
                );
                dealSnapshot = JSON.stringify(subs);
            }

            await client.query(
                `INSERT INTO order_items
         (order_id, product_id, deal_id, variant_id,
          product_name, variant_label, img,
          unit_price, quantity, line_total, deal_items_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    order.id,
                    item.product_id || null,
                    item.deal_id || null,
                    item.variant_id || null,
                    item.product_name,
                    item.variant_label || null,
                    item.img,
                    item.unit_price,
                    item.quantity,
                    lineTotal,
                    dealSnapshot,
                ]
            );
        }

        // Retire cart
        await client.query(
            "UPDATE carts SET status='converted' WHERE id=$1",
            [cart.id]
        );
        await client.query("DELETE FROM cart_items WHERE cart_id=$1", [cart.id]);

        await client.query("COMMIT");

        res.status(201).json({
            order: {
                id: order.id,
                order_token: order.order_token,
                total: order.total,
                status: order.status,
                created_at: order.created_at,
            },
            tracking_url: `/orders/${order.order_token}`,
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch { }
        if (
            err.message.includes("required") ||
            err.message.includes("Cart") ||
            err.message.includes("session")
        ) {
            return res.status(400).json({ message: err.message });
        }
        next(err);
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────
// GET /api/orders/track/:token  (public — guest tracking)
// ─────────────────────────────────────────────
exports.trackOrder = async (req, res, next) => {
    try {
        const { token } = req.params;
        const { rows } = await db.query(
            "SELECT * FROM orders WHERE order_token=$1",
            [token]
        );
        if (!rows.length) return res.status(404).json({ message: "Order not found" });

        const order = rows[0];
        const { rows: items } = await db.query(
            "SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",
            [order.id]
        );

        res.json({ order: { ...order, items } });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/orders/my  (logged-in user's history)
// ─────────────────────────────────────────────
exports.myOrders = async (req, res, next) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ message: "Not authenticated" });

        const { rows } = await db.query(
            `SELECT id, order_token, total, status, payment_method,
              customer_name, delivery_city, created_at
       FROM orders WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 100`,
            [req.user.id]
        );
        res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/orders/session/:sid  (guest order history)
// ─────────────────────────────────────────────
exports.sessionOrders = async (req, res, next) => {
    try {
        const { sid } = req.params;
        if (!sid) return res.json({ orders: [] });

        const { rows } = await db.query(
            `SELECT id, order_token, total, status, payment_method,
              customer_name, delivery_city, created_at
       FROM orders WHERE session_id=$1
       ORDER BY created_at DESC LIMIT 100`,
            [sid]
        );
        res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/admin/orders
// ─────────────────────────────────────────────
exports.adminListOrders = async (req, res, next) => {
    try {
        const { status } = req.query;
        const where = status ? "WHERE status=$1" : "";
        const params = status ? [status] : [];

        const { rows } = await db.query(
            `SELECT id, order_token, customer_name, customer_phone, total,
              status, payment_method, payment_txn_id, payment_status, created_at
       FROM orders ${where}
       ORDER BY created_at DESC LIMIT 200`,
            params
        );
        res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/orders/:id/status
// ─────────────────────────────────────────────
exports.updateOrderStatus = async (req, res, next) => {
    try {
        const ALLOWED = [
            "pending", "confirmed", "preparing",
            "out_for_delivery", "delivered", "cancelled",
        ];
        const { status } = req.body;
        if (!ALLOWED.includes(status))
            return res.status(400).json({ message: "Invalid status" });

        const { rows } = await db.query(
            `UPDATE orders SET status=$1 WHERE id=$2
       RETURNING id, order_token, status`,
            [status, req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Order not found" });
        res.json({ order: rows[0] });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/orders/:id/payment
// Verify manual payment (approve/reject)
// ─────────────────────────────────────────────
exports.updatePaymentStatus = async (req, res, next) => {
    try {
        const { payment_status } = req.body;
        if (!["unpaid", "paid", "refunded"].includes(payment_status))
            return res.status(400).json({ message: "Invalid payment status" });

        const { rows } = await db.query(
            `UPDATE orders SET payment_status=$1,
       status = CASE WHEN $1 = 'paid' AND status = 'pending' THEN 'confirmed' ELSE status END
       WHERE id=$2
       RETURNING id, order_token, status, payment_status`,
            [payment_status, req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Order not found" });
        res.json({ order: rows[0] });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/orders/:token/cancel
// Guest or user can cancel their own order
// Only if status is 'pending' or 'confirmed'
// ─────────────────────────────────────────────
exports.cancelOwnOrder = async (req, res, next) => {
    try {
        const { token } = req.params;
        const userId = req.user?.id || null;
        const sessionId = req.headers["x-cart-session"] || null;

        const { rows } = await db.query(
            "SELECT * FROM orders WHERE order_token=$1",
            [token]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Order not found" });

        const order = rows[0];

        // Ownership check
        const ownsIt =
            (userId && order.user_id === userId) ||
            (!userId && sessionId && order.session_id === sessionId);

        if (!ownsIt)
            return res.status(403).json({ message: "Not your order" });

        if (!["pending", "confirmed"].includes(order.status))
            return res.status(400).json({
                message: "Order is too far along to cancel. Contact support.",
            });

        const { rows: updated } = await db.query(
            `UPDATE orders SET status='cancelled'
       WHERE id=$1 RETURNING id, order_token, status`,
            [order.id]
        );

        res.json({ order: updated[0] });
    } catch (err) {
        next(err);
    }
};
