// server.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const metadataRoutes = require('./routes/metadata');
const requestsRoutes = require('./routes/requests');
const videosRoutes = require('./routes/videos');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/pullmap',
});

app.use((req, _res, next) => {
  req.pool = pool;
  next();
});

app.use('/api', metadataRoutes);
app.use('/api', requestsRoutes);
app.use('/api', videosRoutes);

app.use('/videos', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
