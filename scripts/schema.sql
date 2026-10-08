-- PostgreSQL schema for CryptoHub.
-- FastAPI + SQLAlchemy can also auto-create these tables at startup.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'user',
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))
);

CREATE TABLE IF NOT EXISTS portfolio_entries (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    asset_name VARCHAR(50) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    average_buy_price DOUBLE PRECISION NOT NULL CHECK (average_buy_price > 0),
    target_price DOUBLE PRECISION NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_portfolio_entries_user_id ON portfolio_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_entries_symbol ON portfolio_entries(symbol);

-- Promote any registered account to admin manually when needed.
-- Replace 'trader01' with the username you want to promote.
-- UPDATE users SET role = 'admin' WHERE username = 'trader01';
