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

-- ============================================================
-- frames: 動画から抽出した静止画フレーム
-- ============================================================
CREATE TABLE IF NOT EXISTS frames (
    id          SERIAL PRIMARY KEY,
    segment_id  TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    frame_path  TEXT NOT NULL,
    frame_index INTEGER NOT NULL DEFAULT 0,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    heading     DOUBLE PRECISION,
    captured_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- passes: 連続した録画セッション（1回の道の通過）
-- ============================================================
CREATE TABLE IF NOT EXISTS passes (
    id                SERIAL PRIMARY KEY,
    device_id         TEXT NOT NULL,
    direction_degrees DOUBLE PRECISION,
    direction_label   TEXT,
    started_at        TIMESTAMPTZ NOT NULL,
    ended_at          TIMESTAMPTZ NOT NULL,
    segment_count     INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- pass_segments: パスとセグメントの紐付け
-- ============================================================
CREATE TABLE IF NOT EXISTS pass_segments (
    pass_id        INTEGER NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
    segment_id     TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL,
    PRIMARY KEY (pass_id, segment_id)
);

-- ============================================================
-- change_detections: 2フレーム間の差分検知結果
-- ============================================================
CREATE TABLE IF NOT EXISTS change_detections (
    id                SERIAL PRIMARY KEY,
    frame_a_id        INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    frame_b_id        INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    pass_a_id         INTEGER NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
    pass_b_id         INTEGER NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
    similarity_score  DOUBLE PRECISION NOT NULL,
    change_percentage DOUBLE PRECISION NOT NULL,
    diff_image_path   TEXT,
    latitude          DOUBLE PRECISION NOT NULL,
    longitude         DOUBLE PRECISION NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
