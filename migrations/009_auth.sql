-- migrations/009_auth.sql
-- Authentication tables: app_user, user_session, password_reset

-- Enable citext for case-insensitive email handling
CREATE EXTENSION IF NOT EXISTS citext;

-- app_user: local user accounts with password auth
CREATE TABLE app_user (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_email_per_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX idx_app_user_tenant_id ON app_user(tenant_id);
CREATE INDEX idx_app_user_tenant_email ON app_user(tenant_id, lower(email));

-- user_session: JWT refresh token sessions
CREATE TABLE user_session (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  user_agent TEXT,
  ip VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_session_user_id ON user_session(user_id);
CREATE INDEX idx_user_session_token_hash ON user_session(refresh_token_hash);
CREATE INDEX idx_user_session_expires_at ON user_session(expires_at);

-- password_reset: password reset tokens
CREATE TABLE password_reset (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_reset_user_id ON password_reset(user_id);
CREATE INDEX idx_password_reset_token_hash ON password_reset(token_hash);
CREATE INDEX idx_password_reset_expires_at ON password_reset(expires_at);
