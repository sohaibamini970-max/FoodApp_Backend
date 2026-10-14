-- Users table (supports local + OAuth)
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT,                       -- NULL for OAuth-only users
  role            VARCHAR(20) NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  provider        VARCHAR(20) NOT NULL DEFAULT 'local', -- 'local' | 'google' | 'facebook'
  provider_id     VARCHAR(255),               -- OAuth provider user id
  avatar_url      TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);

-- Refresh tokens (for JWT rotation / logout)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS verification_codes (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verif_user ON verification_codes(user_id);

-- ─── Categories ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) UNIQUE NOT NULL,
  slug        VARCHAR(60) UNIQUE NOT NULL,
  icon        VARCHAR(16) NOT NULL DEFAULT '🍽️',
  icon_url    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

-- ─── Products ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  slug         VARCHAR(140) UNIQUE NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  long_desc    TEXT NOT NULL DEFAULT '',
  price        INTEGER NOT NULL CHECK (price >= 0),
  old_price    INTEGER CHECK (old_price IS NULL OR old_price >= 0),
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  img          TEXT NOT NULL,
  rating       NUMERIC(2,1) NOT NULL DEFAULT 5.0 CHECK (rating >= 0 AND rating <= 5),
  reviews      INTEGER NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  time         VARCHAR(20) NOT NULL DEFAULT '25 min',
  calories     INTEGER NOT NULL DEFAULT 0 CHECK (calories >= 0),
  serves       VARCHAR(40) NOT NULL DEFAULT '1 person',
  ingredients  TEXT[] NOT NULL DEFAULT '{}',
  veg          BOOLEAN NOT NULL DEFAULT FALSE,
  spicy        BOOLEAN NOT NULL DEFAULT FALSE,
  popular      BOOLEAN NOT NULL DEFAULT FALSE,
  available    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS product_variants (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label       VARCHAR(60) NOT NULL,
  price       INTEGER NOT NULL CHECK (price >= 0),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- ─── Carts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id    VARCHAR(64),                -- for guest carts
  status        VARCHAR(20) NOT NULL DEFAULT 'active', -- active | converted | abandoned
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id) WHERE session_id IS NOT NULL;

-- One active cart per user
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_user_active
  ON carts(user_id) WHERE user_id IS NOT NULL AND status = 'active';

-- One active cart per session
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_session_active
  ON carts(session_id) WHERE session_id IS NOT NULL AND status = 'active';

-- ─── Cart Items ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart_items (
  id            SERIAL PRIMARY KEY,
  cart_id       INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id    INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price    INTEGER NOT NULL CHECK (unit_price >= 0),
  -- snapshot for display (in case product is deleted later)
  product_name  VARCHAR(140) NOT NULL,
  variant_label VARCHAR(60),
  img           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);

-- Unique line per (cart, product, variant)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_item_line
  ON cart_items(cart_id, product_id, COALESCE(variant_id, 0));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS delivery_fee INTEGER NOT NULL DEFAULT 199 CHECK (delivery_fee >= 0);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00 CHECK (tax_percent >= 0 AND tax_percent <= 100);

-- ─── Deals ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(120) NOT NULL,
  subtitle      VARCHAR(120) NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  img           TEXT NOT NULL,
  badge         VARCHAR(60) NOT NULL DEFAULT '',
  tag_color     VARCHAR(80) NOT NULL DEFAULT 'from-orange-500 to-red-500',
  ends_in       VARCHAR(40) NOT NULL DEFAULT '2 days',
  category      VARCHAR(60) NOT NULL DEFAULT 'Combo',

  -- Pricing
  base_price    INTEGER NOT NULL CHECK (base_price >= 0),   -- auto-sum of products
  deal_price    INTEGER NOT NULL CHECK (deal_price >= 0),   -- what customer pays
  delivery_fee  INTEGER NOT NULL DEFAULT 199 CHECK (delivery_fee >= 0),
  tax_percent   NUMERIC(5,2) NOT NULL DEFAULT 5.00 CHECK (tax_percent >= 0 AND tax_percent <= 100),

  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_active ON deals(active);
CREATE INDEX IF NOT EXISTS idx_deals_created ON deals(created_at DESC);

-- ─── Deal ↔ Products (many-to-many) ─────────────────
CREATE TABLE IF NOT EXISTS deal_items (
  id          SERIAL PRIMARY KEY,
  deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON deal_items(deal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deal_item ON deal_items(deal_id, product_id);

-- ─── Cart items must support deals ──────────────────
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE;


CREATE TABLE IF NOT EXISTS contact_messages (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  subject     VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'new',
  -- new | read | replied | archived
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address  VARCHAR(64),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at DESC);

DROP TRIGGER IF EXISTS trg_contact_updated_at ON contact_messages;
CREATE TRIGGER trg_contact_updated_at
BEFORE UPDATE ON contact_messages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only one of product_id/deal_id should be set — enforce at app level
-- (Postgres CHECK would be complex with NULL logic; app-level is enough)

DROP TRIGGER IF EXISTS trg_deals_updated_at ON deals;
CREATE TRIGGER trg_deals_updated_at
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_carts_updated_at ON carts;
CREATE TRIGGER trg_carts_updated_at
BEFORE UPDATE ON carts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cart_items_updated_at ON cart_items;
CREATE TRIGGER trg_cart_items_updated_at
BEFORE UPDATE ON cart_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Trigger for updated_at ─────────────────────────────
DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();