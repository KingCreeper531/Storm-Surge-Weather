// ================================================================
//  STORM SURGE WEATHER — Backend Server v1.0
//  Node.js + Express
//  Handles: auth, posts (Google Cloud Storage), weather proxy,
//           caching, username uniqueness
//  Deploy to: Render.com
// ================================================================

const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { Storage } = require('@google-cloud/storage');
const NodeCache  = require('node-cache');
const rateLimit  = require('express-rate-limit');
const multer     = require('multer');
const path       = require('path');

const app   = express();
const cache = new NodeCache({ stdTTL: 600 }); // 10 min default cache
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// ── ENV ──────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-render-dashboard';
const GCS_KEY    = process.env.GOOGLE_CLOUD_KEY;      // JSON string of service account key
const GCS_BUCKET = process.env.GCS_BUCKET || 'storm_surge_bucket';
const GCS_PROJECT= process.env.GCS_PROJECT || 'storm-surge-487802';
const WEATHER_KEY= process.env.GOOGLE_WEATHER_KEY;    // Google Weather API key

// ── GOOGLE CLOUD STORAGE ─────────────────────────────────────────
let storage, bucket;
try {
  const credentials = GCS_KEY ? JSON.parse(GCS_KEY) : null;
  storage = new Storage({
    projectId: GCS_PROJECT,
    ...(credentials && { credentials })
  });
  bucket = storage.bucket(GCS_BUCKET);
  console.log('✅ Google Cloud Storage connected');
} catch(e) {
  console.warn('⚠ GCS not configured:', e.message);
}

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET','POST','DELETE','PATCH'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60*1000, max: 60, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Too many auth attempts' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── GCS HELPERS ──────────────────────────────────────────────────
async function gcsRead(filename, fallback = null) {
  if (!bucket) return fallback;
  try {
    const [data] = await bucket.file(filename).download();
    return JSON.parse(data.toString());
  } catch(e) {
    if (e.code === 404) return fallback;
    throw e;
  }
}

async function gcsWrite(filename, data) {
  if (!bucket) throw new Error('GCS not configured');
  await bucket.file(filename).save(JSON.stringify(data), {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-cache' }
  });
}

async function gcsUploadImage(buffer, filename, contentType) {
  if (!bucket) throw new Error('GCS not configured');
  const file = bucket.file(`images/${filename}`);
  await file.save(buffer, { contentType, public: true });
  return `https://storage.googleapis.com/${GCS_BUCKET}/images/${filename}`;
}

// ================================================================
//  AUTH ROUTES
// ================================================================

// GET /api/auth/check-username — check if username is taken
app.get('/api/auth/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username || username.length < 2) return res.json({ available: false, reason: 'Too short' });
  if (username.length > 30) return res.json({ available: false, reason: 'Too long (max 30 chars)' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.json({ available: false, reason: 'Letters, numbers and _ only' });
  try {
    const users = await gcsRead('users.json', {});
    const taken = Object.values(users).some(u => u.name.toLowerCase() === username.toLowerCase());
    res.json({ available: !taken, reason: taken ? 'Username already taken' : null });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'Name must be 2-30 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'Username: letters, numbers, _ only' });

  try {
    const users = await gcsRead('users.json', {});

    // Check email taken
    if (users[email.toLowerCase()]) return res.status(409).json({ error: 'Email already registered' });

    // Check username taken (case-insensitive)
    const nameTaken = Object.values(users).some(u => u.name.toLowerCase() === name.toLowerCase());
    if (nameTaken) return res.status(409).json({ error: 'Username already taken — try another' });

    // Hash password
    const hash = await bcrypt.hash(password, 12);
    users[email.toLowerCase()] = {
      name,
      email: email.toLowerCase(),
      hash,
      joinedAt: new Date().toISOString(),
      avatar: null
    };

    await gcsWrite('users.json', users);

    const token = jwt.sign({ name, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { name, email: email.toLowerCase() } });
  } catch(e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const users = await gcsRead('users.json', {});
    const user = users[email.toLowerCase()];
    if (!user) return res.status(401).json({ error: 'No account with that email' });

    const valid = await bcrypt.compare(password, user.hash);
    if (!valid) return res.status(401).json({ error: 'Wrong password' });

    const token = jwt.sign({ name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch(e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
//  POSTS ROUTES
// ================================================================

// GET /api/posts — get all posts (with optional filters)
app.get('/api/posts', async (req, res) => {
  try {
    const cacheKey = 'all_posts';
    let posts = cache.get(cacheKey);
    if (!posts) {
      posts = await gcsRead('posts.json', []);
      cache.set(cacheKey, posts, 30); // 30s cache for posts
    }

    // Filter by bounding box (radar view)
    const { north, south, east, west } = req.query;
    if (north && south && east && west) {
      posts = posts.filter(p =>
        p.lat != null && p.lng != null &&
        p.lat >= +south && p.lat <= +north &&
        p.lng >= +west  && p.lng <= +east
      );
    }

    // Filter by location name
    const { location } = req.query;
    if (location) {
      const loc = location.toLowerCase();
      posts = posts.filter(p => p.location.toLowerCase().includes(loc));
    }

    res.json(posts.slice().reverse()); // newest first
  } catch(e) {
    console.error('Get posts error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts — create post
app.post('/api/posts', requireAuth, async (req, res) => {
  const { text, location, lat, lng } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Post text required' });
  if (text.length > 500) return res.status(400).json({ error: 'Post too long (max 500 chars)' });

  try {
    const posts = await gcsRead('posts.json', []);
    const post = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      author: req.user.name,
      location: location || 'Unknown',
      lat: lat ? +lat : null,
      lng: lng ? +lng : null,
      text: text.trim(),
      ts: new Date().toISOString(),
      likes: [],
      comments: [],
      img: null
    };
    posts.push(post);
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json(post);
  } catch(e) {
    console.error('Post error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/image — upload image for post
app.post('/api/posts/:id/image', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const posts = await gcsRead('posts.json', []);
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.author !== req.user.name) return res.status(403).json({ error: 'Not your post' });

    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `${req.params.id}${ext}`;
    const url = await gcsUploadImage(req.file.buffer, filename, req.file.mimetype);
    post.img = url;
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json({ url });
  } catch(e) {
    console.error('Image upload error:', e);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const posts = await gcsRead('posts.json', []);
    const idx = posts.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Post not found' });
    if (posts[idx].author !== req.user.name) return res.status(403).json({ error: 'Not your post' });
    posts.splice(idx, 1);
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/posts/:id/like — toggle like
app.patch('/api/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const posts = await gcsRead('posts.json', []);
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    post.likes = post.likes || [];
    const idx = post.likes.indexOf(req.user.name);
    if (idx >= 0) post.likes.splice(idx, 1); else post.likes.push(req.user.name);
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json({ likes: post.likes });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/comments
app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });
  if (text.length > 280) return res.status(400).json({ error: 'Comment too long (max 280 chars)' });
  try {
    const posts = await gcsRead('posts.json', []);
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const comment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      author: req.user.name,
      text: text.trim(),
      ts: new Date().toISOString()
    };
    post.comments = post.comments || [];
    post.comments.push(comment);
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json(comment);
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/posts/:id/comments/:cid
app.delete('/api/posts/:id/comments/:cid', requireAuth, async (req, res) => {
  try {
    const posts = await gcsRead('posts.json', []);
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const comment = post.comments?.find(c => c.id === req.params.cid);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.author !== req.user.name) return res.status(403).json({ error: 'Not your comment' });
    post.comments = post.comments.filter(c => c.id !== req.params.cid);
    await gcsWrite('posts.json', posts);
    cache.del('all_posts');
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
//  WEATHER PROXY — Google Weather API with caching
// ================================================================
app.get('/api/weather', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const cacheKey = `weather_${(+lat).toFixed(2)}_${(+lng).toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, _cached: true });

  try {
    if (!WEATHER_KEY) throw new Error('No weather API key');

    // Google Weather API
    const url = `https://weather.googleapis.com/v1/forecast?key=${WEATHER_KEY}&location.latitude=${lat}&location.longitude=${lng}&days=8&pageSize=240&languageCode=en-US`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Google Weather API: ${r.status}`);
    const data = await r.json();

    cache.set(cacheKey, data, 600); // 10 min cache
    res.json(data);
  } catch(e) {
    console.warn('Google Weather failed, falling back to Open-Meteo:', e.message);
    // Fallback to Open-Meteo
    try {
      const fallbackUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
        + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,`
        + `weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index`
        + `&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability`
        + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,`
        + `precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=8`;
      const fr = await fetch(fallbackUrl);
      const fd = await fr.json();
      fd._source = 'open-meteo-fallback';
      cache.set(cacheKey, fd, 600);
      res.json(fd);
    } catch(fe) {
      res.status(503).json({ error: 'Weather service unavailable' });
    }
  }
});

// ================================================================
//  HEALTH CHECK
// ================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    gcs: !!bucket,
    weatherKey: !!WEATHER_KEY,
    uptime: Math.round(process.uptime()) + 's'
  });
});


// ── SERVE FRONTEND ──────────────────────────────────────────────
// In production, Express serves the frontend from /public
// In dev, use a local server for the frontend separately
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// Any route not matched by the API falls through to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── START ────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`⛈  Storm Surge API running on port ${PORT}`));