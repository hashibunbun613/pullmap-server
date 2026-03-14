-- schema.sql

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ============================================================
-- segments: iOS端末から受信したメタデータ＋動画パスを管理
-- ============================================================
CREATE TABLE IF NOT EXISTS segments (
    id            TEXT PRIMARY KEY,
    device_id     TEXT NOT NULL,
    file_name     TEXT,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    video_path    TEXT,
    video_received_at TIMESTAMPTZ
);

-- ============================================================
-- request_points: 管理者が指定する動画取得要求地点
-- ============================================================
CREATE TABLE IF NOT EXISTS request_points (
    id          SERIAL PRIMARY KEY,
    label       TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    radius_m    DOUBLE PRECISION NOT NULL DEFAULT 50,
    priority    INTEGER NOT NULL DEFAULT 1,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- video_requests: セグメントと要求地点のマッチング結果
-- ============================================================
CREATE TABLE IF NOT EXISTS video_requests (
    id               SERIAL PRIMARY KEY,
    request_point_id INTEGER NOT NULL REFERENCES request_points(id) ON DELETE CASCADE,
    segment_id       TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    device_id        TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at     TIMESTAMPTZ,
    CONSTRAINT unique_video_request UNIQUE (request_point_id, segment_id, device_id)
);
