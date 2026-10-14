const axios = require("axios");
const db = require("../config/db");
const { signAccess, signRefresh } = require("../utils/jwt");
const crypto = require("crypto");

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

async function upsertOAuthUser({ email, name, provider, providerId, avatar }) {
  const existing = await db.query("SELECT * FROM users WHERE email=$1", [
    email.toLowerCase(),
  ]);

  if (existing.rows.length) {
    const u = existing.rows[0];
    // link provider if not set
    await db.query(
      `UPDATE users SET provider=$1, provider_id=$2, avatar_url=COALESCE($3, avatar_url),
       email_verified=TRUE, last_login_at=NOW() WHERE id=$4`,
      [provider, providerId, avatar, u.id]
    );
    return u;
  }

  const { rows } = await db.query(
    `INSERT INTO users (name, email, provider, provider_id, avatar_url, email_verified)
     VALUES ($1,$2,$3,$4,$5,TRUE)
     RETURNING *`,
    [name, email.toLowerCase(), provider, providerId, avatar]
  );
  return rows[0];
}

async function finalizeOAuth(res, user) {
  const payload = { sub: user.id, role: user.role, email: user.email };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(refreshToken)]
  );

  const redirect =
    `${process.env.CLIENT_URL}/oauth/callback` +
    `?accessToken=${accessToken}&refreshToken=${refreshToken}`;
  res.redirect(redirect);
}

/* ---------------- GOOGLE ---------------- */

exports.googleRedirect = (req, res) => {
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
    });
  res.redirect(url);
};

exports.googleCallback = async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");

    const { data: tokenData } = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      })
    );

    const { data: profile } = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    const user = await upsertOAuthUser({
      email: profile.email,
      name: profile.name,
      provider: "google",
      providerId: profile.id,
      avatar: profile.picture,
    });

    await finalizeOAuth(res, user);
  } catch (err) {
    next(err);
  }
};

/* ---------------- FACEBOOK ---------------- */

exports.facebookRedirect = (req, res) => {
  const url =
    `https://www.facebook.com/v18.0/dialog/oauth?` +
    new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID,
      redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
      scope: "email,public_profile",
      response_type: "code",
    });
  res.redirect(url);
};

exports.facebookCallback = async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");

    const { data: tokenData } = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
          code,
        },
      }
    );

    const { data: profile } = await axios.get(
      "https://graph.facebook.com/me",
      {
        params: {
          fields: "id,name,email,picture",
          access_token: tokenData.access_token,
        },
      }
    );

    // Facebook may not return email if not granted
    if (!profile.email)
      return res.status(400).send("Facebook did not return an email");

    const user = await upsertOAuthUser({
      email: profile.email,
      name: profile.name,
      provider: "facebook",
      providerId: profile.id,
      avatar: profile.picture?.data?.url,
    });

    await finalizeOAuth(res, user);
  } catch (err) {
    next(err);
  }
};