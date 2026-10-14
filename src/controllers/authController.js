const db = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");
const { signAccess, signRefresh, verifyRefresh } = require("../utils/jwt");
const crypto = require("crypto");
const { sendVerificationCode } = require("../services/emailService");
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESET_CODE_TTL_MIN = 10;
const RESET_TOKEN_TTL_MIN = 15;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function issueTokens(user) {
  const payload = { sub: user.id, role: user.role, email: user.email };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(refreshToken)]
  );

  return { accessToken, refreshToken };
}

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const emailLower = email.toLowerCase();

    const existing = await db.query("SELECT * FROM users WHERE email=$1", [emailLower]);

    let user;

    if (existing.rows.length) {
      user = existing.rows[0];
      if (user.email_verified) {
        return res.status(409).json({ message: "Email already registered" });
      }
      // Unverified user re-registering → allow, refresh password + name
      const password_hash = await hashPassword(password);
      const updated = await db.query(
        `UPDATE users SET name=$1, password_hash=$2, updated_at=NOW()
         WHERE id=$3 RETURNING id, name, email, role`,
        [name, password_hash, user.id]
      );
      user = updated.rows[0];
    } else {
      const password_hash = await hashPassword(password);
      const created = await db.query(
        `INSERT INTO users (name, email, password_hash, role, provider, email_verified)
         VALUES ($1, $2, $3, 'user', 'local', FALSE)
         RETURNING id, name, email, role`,
        [name, emailLower, password_hash]
      );
      user = created.rows[0];
    }

    // Invalidate old codes for this user
    await db.query(
      "UPDATE verification_codes SET used=TRUE WHERE user_id=$1 AND used=FALSE",
      [user.id]
    );

    // Generate & store new code
    const code = generateCode();
    await db.query(
      `INSERT INTO verification_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${CODE_TTL_MIN} minutes')`,
      [user.id, hashCode(code)]
    );

    // Send email
    try {
      await sendVerificationCode(user.email, code, user.name);
    } catch (mailErr) {
      console.error("Email send failed:", mailErr.message);
      return res.status(500).json({
        message: "Could not send verification email. Please try again.",
      });
    }

    res.status(201).json({
      message: "Verification code sent. Check your email.",
      pendingVerification: true,
      email: user.email,
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyCode = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and code required" });
    }

    const { rows: userRows } = await db.query(
      "SELECT * FROM users WHERE email=$1",
      [email.toLowerCase()]
    );
    const user = userRows[0];
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.email_verified)
      return res.status(400).json({ message: "Email already verified" });

    const { rows: codeRows } = await db.query(
      `SELECT * FROM verification_codes
       WHERE user_id=$1 AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const record = codeRows[0];
    if (!record)
      return res.status(400).json({ message: "Code expired. Request a new one." });

    if (record.attempts >= MAX_ATTEMPTS) {
      await db.query("UPDATE verification_codes SET used=TRUE WHERE id=$1", [record.id]);
      return res.status(429).json({ message: "Too many attempts. Request a new code." });
    }

    if (record.code_hash !== hashCode(code)) {
      await db.query("UPDATE verification_codes SET attempts = attempts + 1 WHERE id=$1", [record.id]);
      return res.status(400).json({ message: "Incorrect code" });
    }

    // ✅ Valid
    await db.query("UPDATE verification_codes SET used=TRUE WHERE id=$1", [record.id]);
    await db.query("UPDATE users SET email_verified=TRUE, last_login_at=NOW() WHERE id=$1", [user.id]);

    // Issue tokens
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    const payload = { sub: user.id, role: user.role, email: user.email };
    const accessToken = signAccess(payload);
    const refreshToken = signRefresh(payload);

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, hashCode(refreshToken)]
    );

    res.json({
      message: "Email verified. Welcome!",
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
};

exports.resendCode = async (req, res, next) => {
  try {
    const { email } = req.body;
    const { rows } = await db.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.email_verified)
      return res.status(400).json({ message: "Email already verified" });

    await db.query(
      "UPDATE verification_codes SET used=TRUE WHERE user_id=$1 AND used=FALSE",
      [user.id]
    );

    const code = generateCode();
    await db.query(
      `INSERT INTO verification_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${CODE_TTL_MIN} minutes')`,
      [user.id, hashCode(code)]
    );

    await sendVerificationCode(user.email, code, user.name);

    res.json({ message: "New code sent." });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await db.query(
      "SELECT * FROM users WHERE email=$1 AND is_active=TRUE",
      [email.toLowerCase()]
    );
    const user = rows[0];

    if (!user || !user.password_hash)
      return res.status(401).json({ message: "Invalid credentials" });

    if (!user.email_verified) {
      return res.status(403).json({
      message: "Please verify your email first",
      pendingVerification: true,
      email: user.email,
      });
    }

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    await db.query("UPDATE users SET last_login_at=NOW() WHERE id=$1", [user.id]);

    const tokens = await issueTokens(user);

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(401).json({ message: "Refresh token required" });

    const decoded = verifyRefresh(refreshToken);
    const stored = await db.query(
      `SELECT * FROM refresh_tokens
       WHERE user_id=$1 AND token_hash=$2 AND revoked=FALSE AND expires_at > NOW()`,
      [decoded.sub, hashToken(refreshToken)]
    );
    if (!stored.rows.length)
      return res.status(401).json({ message: "Refresh token invalid" });

    // rotate
    await db.query("UPDATE refresh_tokens SET revoked=TRUE WHERE id=$1", [
      stored.rows[0].id,
    ]);

    const { rows } = await db.query(
      "SELECT id, name, email, role FROM users WHERE id=$1",
      [decoded.sub]
    );
    const tokens = await issueTokens(rows[0]);
    res.json(tokens);
  } catch (err) {
    return res.status(401).json({ message: "Refresh failed" });
  }
};

// POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.query(
        "UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1",
        [hashToken(refreshToken)]
      );
    }
    res.json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password
// Body: { email }
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const { rows } = await db.query(
      "SELECT id, name, email, email_verified FROM users WHERE email=$1",
      [email.toLowerCase()]
    );

    // Always respond OK to prevent email enumeration
    const genericOK = () =>
      res.json({
        message:
          "If an account exists for this email, a reset code has been sent.",
      });

    if (!rows.length) return genericOK();

    const user = rows[0];
    if (!user.email_verified) {
      // User registered but never verified — they can't reset yet
      return res.status(400).json({
        message: "Please verify your email first. Contact support if stuck.",
        pendingVerification: true,
        email: user.email,
      });
    }

    // Invalidate previous reset codes for this user
    await db.query(
      `UPDATE verification_codes SET used=TRUE
       WHERE user_id=$1 AND purpose='reset' AND used=FALSE`,
      [user.id]
    );

    // Generate + store new code
    const code = generateCode();
    await db.query(
      `INSERT INTO verification_codes (user_id, code_hash, expires_at, purpose)
       VALUES ($1, $2, NOW() + INTERVAL '${RESET_CODE_TTL_MIN} minutes', 'reset')`,
      [user.id, hashCode(code)]
    );

    // Send email
    try {
      await sendVerificationCode(user.email, code, user.name);
    } catch (mailErr) {
      console.error("Email send failed:", mailErr.message);
      return res.status(500).json({
        message: "Could not send reset email. Please try again.",
      });
    }

    genericOK();
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/verify-reset-code
// Body: { email, code }
exports.verifyResetCode = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ message: "Email and code required" });

    const { rows: userRows } = await db.query(
      "SELECT id, email, email_verified FROM users WHERE email=$1",
      [email.toLowerCase()]
    );
    if (!userRows.length) {
      // Pretend success on invalid emails to prevent enumeration
      return res.status(400).json({ message: "Invalid code" });
    }
    const user = userRows[0];

    if (!user.email_verified) {
      return res
        .status(400)
        .json({ message: "Email not verified. Please contact support." });
    }

    // Get the most recent unused reset code
    const { rows: codeRows } = await db.query(
      `SELECT * FROM verification_codes
       WHERE user_id=$1 AND purpose='reset' AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const record = codeRows[0];
    if (!record) {
      return res
        .status(400)
        .json({ message: "Code expired. Request a new one." });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await db.query("UPDATE verification_codes SET used=TRUE WHERE id=$1", [
        record.id,
      ]);
      return res
        .status(429)
        .json({ message: "Too many attempts. Request a new code." });
    }

    if (record.code_hash !== hashCode(String(code))) {
      await db.query(
        "UPDATE verification_codes SET attempts = attempts + 1 WHERE id=$1",
        [record.id]
      );
      return res.status(400).json({ message: "Incorrect code" });
    }

    // ✅ Code valid → burn it, mint a reset token
    await db.query("UPDATE verification_codes SET used=TRUE WHERE id=$1", [
      record.id,
    ]);

    // Generate a long random token; store hashed
    const crypto = require("crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${RESET_TOKEN_TTL_MIN} minutes')`,
      [user.id, tokenHash]
    );

    res.json({
      message: "Code verified. You can now set a new password.",
      reset_token: rawToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password
// Body: { reset_token, password }
exports.resetPassword = async (req, res, next) => {
  try {
    const { reset_token, password } = req.body;
    if (!reset_token || !password)
      return res
        .status(400)
        .json({ message: "Reset token and new password required" });

    if (String(password).length < 6)
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });

    const crypto = require("crypto");
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(reset_token))
      .digest("hex");

    const { rows } = await db.query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash=$1 AND used=FALSE AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length)
      return res
        .status(400)
        .json({ message: "Reset link expired. Please start over." });

    const record = rows[0];

    const password_hash = await hashPassword(password);

    await db.query(
      "UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2",
      [password_hash, record.user_id]
    );

    // Burn the token + all refresh tokens (force re-login everywhere)
    await db.query(
      "UPDATE password_reset_tokens SET used=TRUE WHERE id=$1",
      [record.id]
    );
    await db.query(
      "UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=$1",
      [record.user_id]
    );

    res.json({
      message: "Password reset successful. Please log in again.",
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
exports.me = async (req, res) => {
  res.json({ user: req.user });
};