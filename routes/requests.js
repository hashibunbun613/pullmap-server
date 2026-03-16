// routes/requests.js

const express = require('express');
const router = express.Router();

// GET /api/admin/request-points
router.get('/admin/request-points', async (req, res) => {
  const pool = req.pool;
  try {
    const result = await pool.query(
      `SELECT id, label, latitude, longitude, radius_m, priority, is_active, created_at
       FROM request_points
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/admin/request-points error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/request-points
router.post('/admin/request-points', async (req, res) => {
  const { label, latitude, longitude, radius_m, priority } = req.body;
  const pool = req.pool;
  try {
    const result = await pool.query(
      `INSERT INTO request_points (label, latitude, longitude, radius_m, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [label, latitude, longitude, radius_m || 50, priority || 1]
    );

    const rp = result.rows[0];
    await pool.query(
      `INSERT INTO video_requests (request_point_id, segment_id, device_id)
       SELECT $1, s.id, s.device_id
       FROM segments s
       WHERE earth_distance(
               ll_to_earth($2, $3),
               ll_to_earth(s.latitude, s.longitude)
             ) <= $4
       ON CONFLICT ON CONSTRAINT unique_video_request DO NOTHING`,
      [rp.id, rp.latitude, rp.longitude, rp.radius_m]
    );

    res.status(201).json(rp);
  } catch (err) {
    console.error('POST /api/admin/request-points error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/request-points/:id
router.delete('/admin/request-points/:id', async (req, res) => {
  const pool = req.pool;
  try {
    await pool.query('DELETE FROM request_points WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/request-points error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/request-points/:id — toggle is_active
router.patch('/admin/request-points/:id', async (req, res) => {
  const pool = req.pool;
  try {
    const result = await pool.query(
      `UPDATE request_points
       SET is_active = NOT is_active
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/admin/request-points error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
