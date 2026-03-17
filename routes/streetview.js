const express = require('express');
const router = express.Router();
const { extractAndStore, framesDir } = require('../lib/frame-extractor');
const { comparePassFrames } = require('../lib/change-detector');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads');

// ============================================================
// Pass Detection
// ============================================================

function calcHeading(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function headingToLabel(deg) {
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

// POST /api/admin/detect-passes — auto-detect passes from segments
router.post('/admin/detect-passes', async (req, res) => {
  const pool = req.pool;
  try {
    await pool.query('DELETE FROM pass_segments');
    await pool.query('DELETE FROM passes');

    const { rows: segments } = await pool.query(
      `SELECT id, device_id, latitude, longitude, recorded_at, video_path
       FROM segments
       WHERE video_path IS NOT NULL
       ORDER BY device_id, recorded_at`
    );

    if (segments.length === 0) {
      return res.json({ passes: 0, message: 'No segments with video found' });
    }

    const passes = [];
    let currentPass = [segments[0]];

    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const curr = segments[i];
      const timeDiff = (new Date(curr.recorded_at) - new Date(prev.recorded_at)) / 1000;

      if (curr.device_id === prev.device_id && timeDiff <= 15) {
        currentPass.push(curr);
      } else {
        if (currentPass.length >= 2) passes.push(currentPass);
        currentPass = [curr];
      }
    }
    if (currentPass.length >= 2) passes.push(currentPass);

    let createdCount = 0;
    for (const passSegs of passes) {
      const first = passSegs[0];
      const last = passSegs[passSegs.length - 1];
      const heading = calcHeading(first.latitude, first.longitude, last.latitude, last.longitude);
      const label = headingToLabel(heading);

      const { rows } = await pool.query(
        `INSERT INTO passes (device_id, direction_degrees, direction_label, started_at, ended_at, segment_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [first.device_id, heading, label, first.recorded_at, last.recorded_at, passSegs.length]
      );
      const passId = rows[0].id;

      for (let i = 0; i < passSegs.length; i++) {
        await pool.query(
          `INSERT INTO pass_segments (pass_id, segment_id, sequence_order)
           VALUES ($1, $2, $3)`,
          [passId, passSegs[i].id, i]
        );
      }
      createdCount++;
    }

    res.json({ passes: createdCount });
  } catch (err) {
    console.error('detect-passes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/passes — list all passes
router.get('/passes', async (req, res) => {
  const pool = req.pool;
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM frames f
               JOIN pass_segments ps ON f.segment_id = ps.segment_id
               WHERE ps.pass_id = p.id) AS frame_count
       FROM passes p
       ORDER BY p.started_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/passes/:id/frames — get frames for a pass in order
router.get('/passes/:id/frames', async (req, res) => {
  const pool = req.pool;
  try {
    const { rows } = await pool.query(
      `SELECT f.*, ps.sequence_order
       FROM frames f
       JOIN pass_segments ps ON f.segment_id = ps.segment_id
       WHERE ps.pass_id = $1
       ORDER BY ps.sequence_order`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Bulk Frame Extraction (for existing videos)
// ============================================================

// POST /api/admin/extract-frames — extract frames from all videos that don't have frames yet
router.post('/admin/extract-frames', async (req, res) => {
  const pool = req.pool;
  try {
    const { rows: segments } = await pool.query(
      `SELECT s.id, s.latitude, s.longitude, s.recorded_at, s.video_path
       FROM segments s
       LEFT JOIN frames f ON f.segment_id = s.id
       WHERE s.video_path IS NOT NULL AND f.id IS NULL`
    );

    let extracted = 0;
    for (const seg of segments) {
      const videoPath = path.join(uploadsDir, seg.video_path);
      if (!fs.existsSync(videoPath)) continue;

      await extractAndStore(videoPath, seg, pool);
      extracted++;
    }

    res.json({ total: segments.length, extracted });
  } catch (err) {
    console.error('extract-frames error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Change Detection
// ============================================================

// POST /api/admin/compare-passes — compare two passes
router.post('/admin/compare-passes', async (req, res) => {
  const { passAId, passBId } = req.body;
  const pool = req.pool;

  if (!passAId || !passBId) {
    return res.status(400).json({ error: 'passAId and passBId are required' });
  }

  try {
    // Clear old detections for this pair
    await pool.query(
      `DELETE FROM change_detections WHERE pass_a_id = $1 AND pass_b_id = $2`,
      [passAId, passBId]
    );

    const { rows: framesA } = await pool.query(
      `SELECT f.* FROM frames f
       JOIN pass_segments ps ON f.segment_id = ps.segment_id
       WHERE ps.pass_id = $1
       ORDER BY ps.sequence_order`,
      [passAId]
    );

    const { rows: framesB } = await pool.query(
      `SELECT f.* FROM frames f
       JOIN pass_segments ps ON f.segment_id = ps.segment_id
       WHERE ps.pass_id = $1
       ORDER BY ps.sequence_order`,
      [passBId]
    );

    const results = await comparePassFrames(framesA, framesB, pool, passAId, passBId);

    const avgChange = results.length > 0
      ? results.reduce((s, r) => s + r.changePct, 0) / results.length
      : 0;

    res.json({
      comparisons: results.length,
      avgChangePercent: avgChange.toFixed(2),
      details: results,
    });
  } catch (err) {
    console.error('compare-passes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/change-detections?pass_a=X&pass_b=Y
router.get('/change-detections', async (req, res) => {
  const { pass_a, pass_b } = req.query;
  const pool = req.pool;
  try {
    let query = `SELECT cd.*,
                        fa.frame_path AS frame_a_path,
                        fb.frame_path AS frame_b_path
                 FROM change_detections cd
                 JOIN frames fa ON cd.frame_a_id = fa.id
                 JOIN frames fb ON cd.frame_b_id = fb.id`;
    const params = [];

    if (pass_a && pass_b) {
      query += ` WHERE cd.pass_a_id = $1 AND cd.pass_b_id = $2`;
      params.push(pass_a, pass_b);
    }

    query += ` ORDER BY cd.change_percentage DESC`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Auto Re-request: create request points at high-change locations
// ============================================================

// POST /api/admin/auto-rerequest — create request points where change > threshold
router.post('/admin/auto-rerequest', async (req, res) => {
  const { passAId, passBId, threshold = 10 } = req.body;
  const pool = req.pool;

  try {
    const { rows: detections } = await pool.query(
      `SELECT latitude, longitude, change_percentage
       FROM change_detections
       WHERE pass_a_id = $1 AND pass_b_id = $2
         AND change_percentage >= $3
       ORDER BY change_percentage DESC`,
      [passAId, passBId, threshold]
    );

    let created = 0;
    for (const det of detections) {
      const label = `変化検知 (${det.change_percentage.toFixed(1)}%)`;
      const { rows: existing } = await pool.query(
        `SELECT id FROM request_points
         WHERE earth_distance(ll_to_earth($1, $2), ll_to_earth(latitude, longitude)) <= 30`,
        [det.latitude, det.longitude]
      );

      if (existing.length > 0) continue;

      await pool.query(
        `INSERT INTO request_points (label, latitude, longitude, radius_m, priority)
         VALUES ($1, $2, $3, 30, 1)`,
        [label, det.latitude, det.longitude]
      );
      created++;
    }

    res.json({ detected: detections.length, requestPointsCreated: created });
  } catch (err) {
    console.error('auto-rerequest error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
