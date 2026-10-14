const db = require("../config/db");
const { sendContactNotification } = require("../services/emailService");

// ─────────────────────────────────────────────
// Basic validation
// ─────────────────────────────────────────────
function validateContact(b) {
    const errors = [];

    if (!b.name || !String(b.name).trim()) errors.push("Name is required");
    else if (String(b.name).trim().length < 2)
        errors.push("Name must be at least 2 characters");

    if (!b.email || !String(b.email).trim()) errors.push("Email is required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim()))
        errors.push("Invalid email address");

    if (!b.subject || !String(b.subject).trim()) errors.push("Subject is required");
    else if (String(b.subject).trim().length < 3)
        errors.push("Subject must be at least 3 characters");

    if (!b.message || !String(b.message).trim()) errors.push("Message is required");
    else if (String(b.message).trim().length < 10)
        errors.push("Message must be at least 10 characters");
    else if (String(b.message).trim().length > 5000)
        errors.push("Message is too long (max 5000 characters)");

    // Honeypot — if filled, it's a bot
    if (b.honeypot) errors.push("SPAM");

    return errors;
}

// ─────────────────────────────────────────────
// POST /api/contact  (public)
// ─────────────────────────────────────────────
exports.createMessage = async (req, res, next) => {
    try {
        const b = req.body || {};

        const errors = validateContact(b);
        if (errors.length) {
            // If honeypot fired, pretend success (don't help the bot)
            if (errors.includes("SPAM")) {
                return res.json({
                    message: "Thanks for your message! We'll get back to you soon.",
                });
            }
            return res.status(400).json({ message: errors[0], errors });
        }

        // Insert
        const { rows } = await db.query(
            `INSERT INTO contact_messages
        (name, email, subject, message, user_id, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
            [
                String(b.name).trim().slice(0, 120),
                String(b.email).trim().toLowerCase().slice(0, 255),
                String(b.subject).trim().slice(0, 200),
                String(b.message).trim().slice(0, 5000),
                req.user?.id || null,
                req.ip || req.headers["x-forwarded-for"] || null,
                String(req.headers["user-agent"] || "").slice(0, 500),
            ]
        );

        const contact = rows[0];

        // Fire-and-forget email notification to admin
        // (do not await — don't fail the request if email send fails)
        sendContactNotification({
            name: b.name.trim(),
            email: b.email.trim().toLowerCase(),
            subject: b.subject.trim(),
            message: b.message.trim(),
        }).catch((err) =>
            console.error("[contact] email notification failed:", err.message)
        );

        res.status(201).json({
            message: "Thanks for your message! We'll get back to you soon.",
            id: contact.id,
        });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET /api/admin/contact  (admin only — list all)
// ─────────────────────────────────────────────
exports.adminListMessages = async (req, res, next) => {
    try {
        const { status, search } = req.query;

        const where = [];
        const params = [];
        let i = 1;

        if (status && status !== "all") {
            where.push(`status=$${i++}`);
            params.push(status);
        }
        if (search) {
            where.push(
                `(name ILIKE $${i} OR email ILIKE $${i} OR subject ILIKE $${i} OR message ILIKE $${i})`
            );
            params.push(`%${search}%`);
            i++;
        }

        const { rows } = await db.query(
            `SELECT * FROM contact_messages
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC
       LIMIT 500`,
            params
        );

        // Unread count for badge
        const { rows: countRows } = await db.query(
            `SELECT COUNT(*)::int AS unread FROM contact_messages WHERE status='new'`
        );

        res.json({
            messages: rows,
            unread: countRows[0]?.unread || 0,
        });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/contact/:id  (update status)
// ─────────────────────────────────────────────
exports.updateMessageStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const ALLOWED = ["new", "read", "replied", "archived"];
        if (!ALLOWED.includes(status))
            return res.status(400).json({ message: "Invalid status" });

        const { rows } = await db.query(
            `UPDATE contact_messages SET status=$1 WHERE id=$2
       RETURNING id, status`,
            [status, req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ message: "Message not found" });

        res.json({ message: rows[0] });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// DELETE /api/admin/contact/:id
// ─────────────────────────────────────────────
exports.deleteMessage = async (req, res, next) => {
    try {
        const { rowCount } = await db.query(
            "DELETE FROM contact_messages WHERE id=$1",
            [req.params.id]
        );
        if (!rowCount)
            return res.status(404).json({ message: "Message not found" });

        res.json({ message: "Deleted" });
    } catch (err) {
        next(err);
    }
};