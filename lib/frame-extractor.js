const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const framesDir = path.join(__dirname, '..', 'uploads', 'frames');
if (!fs.existsSync(framesDir)) {
  fs.mkdirSync(framesDir, { recursive: true });
}

function extractFrame(videoPath, segmentId) {
  return new Promise((resolve, reject) => {
    const outFile = `${segmentId}.jpg`;
    const outPath = path.join(framesDir, outFile);

    ffmpeg(videoPath)
      .seekInput(2.5)
      .frames(1)
      .outputOptions('-q:v', '2')
      .output(outPath)
      .on('end', () => resolve({ framePath: outFile, fullPath: outPath }))
      .on('error', (err) => {
        console.error(`[FrameExtractor] Error for ${segmentId}:`, err.message);
        reject(err);
      })
      .run();
  });
}

async function extractAndStore(videoPath, segment, pool) {
  try {
    const { framePath } = await extractFrame(videoPath, segment.id);

    await pool.query(
      `INSERT INTO frames (segment_id, frame_path, frame_index, latitude, longitude, captured_at)
       VALUES ($1, $2, 0, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [segment.id, framePath, segment.latitude, segment.longitude, segment.recorded_at]
    );

    console.log(`[FrameExtractor] Frame extracted for ${segment.id}`);
    return framePath;
  } catch (err) {
    console.error(`[FrameExtractor] Failed for ${segment.id}:`, err.message);
    return null;
  }
}

module.exports = { extractFrame, extractAndStore, framesDir };
