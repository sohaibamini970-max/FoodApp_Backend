const db = require("../config/db");
const { hashPassword } = require("../utils/password");

// GET /api/admin/users
exports.listUsers = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT id, name, email, role, provider, email_verified,
              is_active, created_at, last_login_at
       FROM users
       ORDER BY created_at DESC`
        );
        res.json({ users: rows });
    } catch (err) {
        next(err);
    }
};

// POST /api/admin/users  { name, email, password, role }
exports.createUser = async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password)
            return res.status(400).json({ message: "Missing fields" });
        if (!["user", "admin"].includes(role))
            return res.status(400).json({ message: "Invalid role" });

        const existing = await db.query("SELECT id FROM users WHERE email=$1", [
            email.toLowerCase(),
        ]);
        if (existing.rows.length)
            return res.status(409).json({ message: "Email already registered" });

        const password_hash = await hashPassword(password);

        const { rows } = await db.query(
            `INSERT INTO users (name, email, password_hash, role, provider, email_verified)
       VALUES ($1, $2, $3, $4, 'local', TRUE)
       RETURNING id, name, email, role, provider, email_verified, is_active, created_at, last_login_at`,
            [name, email.toLowerCase(), password_hash, role]
        );
        res.status(201).json({ user: rows[0] });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/admin/users/:id  { name?, role? }
exports.updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, role } = req.body;

        const updates = [];
        const values = [];
        let i = 1;

        if (name) {
            updates.push(`name=$${i++}`);
            values.push(name);
        }
        if (role && ["user", "admin"].includes(role)) {
            // Prevent demoting yourself
            if (Number(id) === req.user.id && role !== "admin") {
                return res.status(400).json({ message: "You cannot demote yourself" });
            }
            updates.push(`role=$${i++}`);
            values.push(role);
        }

        if (!updates.length)
            return res.status(400).json({ message: "Nothing to update" });

        values.push(id);
        const { rows } = await db.query(
            `UPDATE users SET ${updates.join(", ")} WHERE id=$${i}
       RETURNING id, name, email, role, provider, email_verified, is_active, created_at, last_login_at`,
            values
        );

        if (!rows.length) return res.status(404).json({ message: "User not found" });
        res.json({ user: rows[0] });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (Number(id) === req.user.id) {
            return res.status(400).json({ message: "You cannot delete yourself" });
        }

        const { rowCount } = await db.query("DELETE FROM users WHERE id=$1", [id]);
        if (!rowCount) return res.status(404).json({ message: "User not found" });

        res.json({ message: "User deleted" });
    } catch (err) {
        next(err);
    }
};