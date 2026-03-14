// routes/videos.js

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, _file, cb) => cb(null, `${req.params.segmentId}.mp4`),
});
const upload = multer({ storage });

// PUT /api/video/:segmentId
router.put('/video/:segmentId', upload.single('video'), async (req, res) => {
  const { segmentId } = req.params;
  const pool = req.pool;

  try {
    const existing = await pool.query(
      'SELECT recorded_at FROM segments WHERE id = $1',
      [segmentId]
    );

    if (existing.rows.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Segment not found' });
    }

    const incomingRecordedAt = req.body.recordedAt
      ? new Date(req.body.recordedAt)
      : null;
    const existingRecordedAt = new Date(existing.rows[0].recorded_at);

    if (incomingRecordedAt && incomingRecordedAt < existingRecordedAt) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.json({ ok: true, adopted: false, reason: 'Newer recording already exists' });
    }

    const oldVideoPath = (await pool.query(
      'SELECT video_path FROM segments WHERE id = $1', [segmentId]
    )).rows[0].video_path;

    if (oldVideoPath) {
      const oldFullPath = path.join(uploadsDir, path.basename(oldVideoPath));
      if (fs.existsSync(oldFullPath)) fs.unlinkSync(oldFullPath);
    }

    const videoPath = `${segmentId}.mp4`;
    await pool.query(
      `UPDATE segments
       SET video_path = $1, video_received_at = NOW()
       WHERE id = $2`,
      [videoPath, segmentId]
    );

    await pool.query(
      `UPDATE video_requests
       SET status = 'fulfilled', fulfilled_at = NOW()
       WHERE segment_id = $1 AND status = 'pending'`,
      [segmentId]
    );

    res.json({ ok: true, adopted: true });
  } catch (err) {
    console.error('PUT /api/video/:segmentId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/latest-video?lat=xx&lon=yy
router.get('/latest-video', async (req, res) => {
  const { lat, lon } = req.query;
  const pool = req.pool;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, latitude, longitude, recorded_at, video_path
       FROM segments
       WHERE video_path IS NOT NULL
         AND ABS(latitude  - $1) <= 0.001
         AND ABS(longitude - $2) <= 0.001
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [parseFloat(lat), parseFloat(lon)]
    );

    if (result.rows.length === 0) {
      return res.json({ found: false });
    }

    const row = result.rows[0];
    res.json({
      found: true,
      segmentId: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      recordedAt: row.recorded_at,
      videoUrl: `/videos/${row.video_path}`,
    });
  } catch (err) {
    console.error('GET /api/latest-video error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
