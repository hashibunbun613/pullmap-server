const sharp = require('sharp');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const path = require('path');
const fs = require('fs');

const framesDir = path.join(__dirname, '..', 'uploads', 'frames');
const diffsDir = path.join(__dirname, '..', 'uploads', 'diffs');
if (!fs.existsSync(diffsDir)) fs.mkdirSync(diffsDir, { recursive: true });

const COMPARE_WIDTH = 320;
const COMPARE_HEIGHT = 240;

async function toPngBuffer(imagePath) {
  return sharp(imagePath)
    .resize(COMPARE_WIDTH, COMPARE_HEIGHT, { fit: 'cover' })
    .png()
    .toBuffer();
}

async function compareFrames(frameAPath, frameBPath, outputDiffName) {
  const bufA = await toPngBuffer(frameAPath);
  const bufB = await toPngBuffer(frameBPath);

  const imgA = PNG.sync.read(bufA);
  const imgB = PNG.sync.read(bufB);
  const diff = new PNG({ width: COMPARE_WIDTH, height: COMPARE_HEIGHT });

  const numDiffPixels = pixelmatch(
    imgA.data, imgB.data, diff.data,
    COMPARE_WIDTH, COMPARE_HEIGHT,
    { threshold: 0.15 }
  );

  const totalPixels = COMPARE_WIDTH * COMPARE_HEIGHT;
  const changePct = (numDiffPixels / totalPixels) * 100;
  const similarity = 1 - (numDiffPixels / totalPixels);

  let diffImagePath = null;
  if (outputDiffName) {
    diffImagePath = outputDiffName;
    const diffFullPath = path.join(diffsDir, diffImagePath);
    fs.writeFileSync(diffFullPath, PNG.sync.write(diff));
  }

  return { similarity, changePct, diffImagePath, numDiffPixels, totalPixels };
}

async function comparePassFrames(framesA, framesB, pool, passAId, passBId) {
  const results = [];

  for (const fA of framesA) {
    let bestMatch = null;
    let bestDist = Infinity;

    for (const fB of framesB) {
      const dist = geoDistance(fA.latitude, fA.longitude, fB.latitude, fB.longitude);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = fB;
      }
    }

    if (!bestMatch || bestDist > 15) continue;

    const pathA = path.join(framesDir, fA.frame_path);
    const pathB = path.join(framesDir, bestMatch.frame_path);

    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) continue;

    const diffName = `diff_${fA.id}_${bestMatch.id}.png`;
    try {
      const result = await compareFrames(pathA, pathB, diffName);

      await pool.query(
        `INSERT INTO change_detections
         (frame_a_id, frame_b_id, pass_a_id, pass_b_id, similarity_score, change_percentage, diff_image_path, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [fA.id, bestMatch.id, passAId, passBId, result.similarity, result.changePct,
         result.diffImagePath, fA.latitude, fA.longitude]
      );

      results.push({
        frameA: fA.id,
        frameB: bestMatch.id,
        distance: bestDist,
        ...result,
        latitude: fA.latitude,
        longitude: fA.longitude,
      });
    } catch (e) {
      console.error(`[ChangeDetector] compare error:`, e.message);
    }
  }

  return results;
}

function geoDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { compareFrames, comparePassFrames, diffsDir };
