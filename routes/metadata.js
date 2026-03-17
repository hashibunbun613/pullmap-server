// routes/metadata.js

const express = require('express');
const router = express.Router();

// POST /api/metadata
router.post('/metadata', async (req, res) => {
  const { id, deviceId, latitude, longitude, recordedAt, fileName } = req.body;
  const pool = req.pool;

  try {
    // Upsert segment
    await pool.query(
      `INSERT INTO segments (id, device_id, file_name, latitude, longitude, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET device_id    = EXCLUDED.device_id,
             file_name    = EXCLUDED.file_name,
             latitude     = EXCLUDED.latitude,
             longitude    = EXCLUDED.longitude,
             recorded_at  = EXCLUDED.recorded_at,
             received_at  = NOW()
         WHERE EXCLUDED.recorded_at > segments.recorded_at`,
      [id, deviceId, fileName, latitude, longitude, recordedAt]
    );

    // Match against active request_points using earth_distance
    await pool.query(
      `INSERT INTO video_requests (request_point_id, segment_id, device_id)
       SELECT rp.id, $1, $2
       FROM request_points rp
       WHERE rp.is_active = TRUE
         AND earth_distance(
               ll_to_earth(rp.latitude, rp.longitude),
               ll_to_earth($3, $4)
             ) <= rp.radius_m
       ON CONFLICT ON CONSTRAINT unique_video_request DO NOTHING`,
      [id, deviceId, latitude, longitude]
    );

    /*
     * Fallback: earth_distance が使えない環境向け簡易クエリ
     * 緯度1度 ≈ 111,320m なので radius_m / 111320 度以内で近似判定
     *
     * INSERT INTO video_requests (request_point_id, segment_id, device_id)
     * SELECT rp.id, $1, $2
     * FROM request_points rp
     * WHERE rp.is_active = TRUE
     *   AND ABS(rp.latitude  - $3) <= (rp.radius_m / 111320.0)
     *   AND ABS(rp.longitude - $4) <= (rp.radius_m / (111320.0 * COS(RADIANS($3))))
     * ON CONFLICT ON CONSTRAINT unique_video_request DO NOTHING;
     */

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/requests?deviceId=xxx
router.get('/requests', async (req, res) => {
  const { deviceId } = req.query;
  const pool = req.pool;

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const pendingResult = await pool.query(
      `SELECT segment_id FROM video_requests
       WHERE device_id = $1 AND status = 'pending'`,
      [deviceId]
    );

    const pointsResult = await pool.query(
      `SELECT id, label, latitude, longitude, radius_m, priority
       FROM request_points
       WHERE is_active = TRUE
       ORDER BY priority ASC`
    );

    res.json({
      requestedSegmentIds: pendingResult.rows.map(r => r.segment_id),
      requestPoints: pointsResult.rows,
    });
  } catch (err) {
    console.error('GET /api/requests error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/request-all — request ALL videos that haven't been uploaded yet
router.post('/admin/request-all', async (req, res) => {
  const pool = req.pool;
  try {
    // Ensure "全収集" request point exists (huge radius = covers all)
    let { rows: rpRows } = await pool.query(
      `SELECT id FROM request_points WHERE label = '全収集' LIMIT 1`
    );
    if (rpRows.length === 0) {
      const { rows: ins } = await pool.query(
        `INSERT INTO request_points (label, latitude, longitude, radius_m, priority)
         VALUES ('全収集', 0, 0, 999999999, 1)
         RETURNING id`
      );
      rpRows = ins;
    }
    const rpId = rpRows[0].id;

    const { rows } = await pool.query(
      `SELECT id, device_id FROM segments
       WHERE video_path IS NULL
         AND id NOT IN (SELECT segment_id FROM video_requests WHERE status = 'pending')`
    );

    let created = 0;
    for (const seg of rows) {
      const r = await pool.query(
        `INSERT INTO video_requests (request_point_id, segment_id, device_id)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT unique_video_request DO NOTHING`,
        [rpId, seg.id, seg.device_id]
      );
      if (r.rowCount > 0) created++;
    }

    const { rows: pendingRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM video_requests WHERE status = 'pending'`
    );
    const pendingCount = parseInt(pendingRows[0].n, 10);

    res.json({
      total: rows.length,
      requested: created,
      pendingTotal: pendingCount,
    });
  } catch (err) {
    console.error('POST /api/admin/request-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/segments
router.get('/admin/segments', async (req, res) => {
  const pool = req.pool;
  try {
    const result = await pool.query(
      `SELECT id, device_id, file_name, latitude, longitude, recorded_at, received_at,
              video_path, video_received_at
       FROM segments
       ORDER BY received_at DESC
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/admin/segments error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
