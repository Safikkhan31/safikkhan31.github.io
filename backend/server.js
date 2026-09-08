require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const scoreRoutes = require('./routes/scores');

const app = express();

// ---- CORS ----
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  })
);

app.use(express.json());

// ---- Routes ----
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/scores', scoreRoutes);

// ---- 404 + error handling ----
app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Ascent API listening on port ${PORT}`));
});
