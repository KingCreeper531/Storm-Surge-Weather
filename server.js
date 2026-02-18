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
const TOMORROW_KEY  = process.env.TOMORROW_API_KEY;     // tomorrow.io API key
const WEATHERNEXT_KEY = process.env.WEATHERNEXT_KEY;  // WeatherNext 2 API key

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

// ── IN-MEMORY FALLBACK (used when GCS not configured) ────────────
const memStore = {};

// ── GCS HELPERS ──────────────────────────────────────────────────
async function gcsRead(filename, fallback = null) {
  if (!bucket) {
    console.warn(`GCS not configured — using in-memory store for ${filename}`);
    return memStore[filename] ?? fallback;
  }
  try {
    const [data] = await bucket.file(filename).download();
    return JSON.parse(data.toString());
  } catch(e) {
    if (e.code === 404) return fallback;
    console.error('GCS read error:', e.message);
    return memStore[filename] ?? fallback; // fallback to memory on error
  }
}

async function gcsWrite(filename, data) {
  // Always write to memory first so reads are fast
  memStore[filename] = data;
  if (!bucket) {
    console.warn(`GCS not configured — data for ${filename} stored in memory only (lost on restart)`);
    return;
  }
  try {
    await bucket.file(filename).save(JSON.stringify(data), {
      contentType: 'application/json',
      metadata: { cacheControl: 'no-cache' }
    });
  } catch(e) {
    console.error('GCS write error:', e.message);
    // Don't throw — memory write succeeded, GCS failure is non-fatal
  }
}

async function gcsUploadImage(buffer, filename, contentType) {
  if (!bucket) {
    console.warn('GCS not configured — image cannot be stored persistently');
    throw new Error('Image storage not configured');
  }
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
//  WEATHER PROXY — WeatherNext 2 (tomorrow.io) with caching
// ================================================================
app.get('/api/weather', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const cacheKey = `weather_${(+lat).toFixed(2)}_${(+lng).toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, _cached: true });

  // Try WeatherNext 2 / tomorrow.io first
  if (TOMORROW_KEY) {
    try {
      // tomorrow.io Timelines API — current + hourly + daily in one call
      const fields = [
        'temperature','temperatureApparent','humidity','precipitationProbability',
        'precipitationIntensity','weatherCode','windSpeed','windDirection',
        'pressureSurfaceLevel','cloudCover','uvIndex','sunriseTime','sunsetTime',
        'temperatureMax','temperatureMin','windSpeedMax'
      ].join(',');
      const url = `https://api.tomorrow.io/v4/timelines?location=${lat},${lng}`
        + `&fields=${fields}`
        + `&timesteps=current,1h,1d&units=metric&timezone=auto`
        + `&apikey=${TOMORROW_KEY}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`tomorrow.io: ${r.status} ${await r.text()}`);
      const raw = await r.json();
      const normalised = normaliseTomorrowIO(raw);
      normalised._source = 'tomorrow-io';
      cache.set(cacheKey, normalised, 600);
      return res.json(normalised);
    } catch(e) {
      console.warn('tomorrow.io failed:', e.message);
    }
  }

  // Fallback: Open-Meteo (free, no key needed)
  try {
    const fallbackUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,`
      + `weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index`
      + `&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,`
      + `precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=8`;
    const fr = await fetch(fallbackUrl);
    if (!fr.ok) throw new Error('Open-Meteo failed');
    const fd = await fr.json();
    fd._source = 'open-meteo-fallback';
    cache.set(cacheKey, fd, 600);
    return res.json(fd);
  } catch(fe) {
    res.status(503).json({ error: 'All weather services unavailable' });
  }
});

// Normalise tomorrow.io Timelines response → Open-Meteo shape
// so the frontend doesn't need to change
function normaliseTomorrowIO(raw) {
  const timelines = raw?.data?.timelines || [];
  const current1h = timelines.find(t => t.timestep === 'current')?.intervals?.[0]?.values || {};
  const hourly    = timelines.find(t => t.timestep === '1h')?.intervals || [];
  const daily     = timelines.find(t => t.timestep === '1d')?.intervals || [];

  return {
    current: {
      temperature_2m:       current1h.temperature       ?? 0,
      apparent_temperature: current1h.temperatureApparent ?? 0,
      relative_humidity_2m: current1h.humidity           ?? 0,
      precipitation:        current1h.precipitationIntensity ?? 0,
      weather_code:         tomorrowCodeToWMO(current1h.weatherCode),
      wind_speed_10m:       current1h.windSpeed          ?? 0,
      wind_direction_10m:   current1h.windDirection      ?? 0,
      surface_pressure:     current1h.pressureSurfaceLevel ?? 1013,
      cloud_cover:          current1h.cloudCover         ?? 0,
      uv_index:             current1h.uvIndex            ?? 0
    },
    hourly: {
      time:                       hourly.map(h => h.startTime),
      temperature_2m:             hourly.map(h => h.values.temperature       ?? 0),
      relative_humidity_2m:       hourly.map(h => h.values.humidity          ?? 0),
      weather_code:               hourly.map(h => tomorrowCodeToWMO(h.values.weatherCode)),
      precipitation_probability:  hourly.map(h => h.values.precipitationProbability ?? 0)
    },
    daily: {
      time:                         daily.map(d => d.startTime?.slice(0,10)),
      temperature_2m_max:           daily.map(d => d.values.temperatureMax   ?? 0),
      temperature_2m_min:           daily.map(d => d.values.temperatureMin   ?? d.values.temperature ?? 0),
      weather_code:                 daily.map(d => tomorrowCodeToWMO(d.values.weatherCode)),
      sunrise:                      daily.map(d => d.values.sunriseTime      || ''),
      sunset:                       daily.map(d => d.values.sunsetTime       || ''),
      precipitation_probability_max:daily.map(d => d.values.precipitationProbability ?? 0),
      wind_speed_10m_max:           daily.map(d => d.values.windSpeedMax     ?? d.values.windSpeed ?? 0)
    }
  };
}

// tomorrow.io weather codes → WMO codes (used by frontend icons/descriptions)
function tomorrowCodeToWMO(code) {
  if (!code) return 0;
  const map = {
    1000:0, 1100:1, 1101:2, 1102:3, 1001:3,        // clear/cloudy
    2000:45, 2100:48,                                 // fog
    4000:51, 4001:61, 4200:61, 4201:65,              // rain
    5000:71, 5001:77, 5100:71, 5101:75,              // snow
    6000:56, 6001:65, 6200:56, 6201:65,              // freezing rain
    7000:77, 7101:77, 7102:77,                        // ice pellets
    8000:95                                            // thunderstorm
  };
  return map[code] ?? 0;
}

// ── TOMORROW.IO MAP TILES PROXY ──────────────────────────────────
// Proxies tile requests to avoid CORS and keep key server-side
app.get('/api/tiles/:layer/:z/:x/:y', async (req, res) => {
  if (!TOMORROW_KEY) return res.status(503).json({ error: 'Tiles not configured' });
  const { layer, z, x, y } = req.params;
  const validLayers = ['precipitation_intensity','temperature','wind_speed','cloud_cover','pressure_surface_level'];
  if (!validLayers.includes(layer)) return res.status(400).json({ error: 'Invalid layer' });
  try {
    // Get latest timestamp for tiles
    const tsRes = await fetch(`https://api.tomorrow.io/v4/map/tile/${layer}?apikey=${TOMORROW_KEY}`);
    const tsData = tsRes.ok ? await tsRes.json() : null;
    const timestamp = tsData?.timestamps?.[tsData.timestamps.length - 1] || new Date().toISOString().slice(0,13) + ':00:00Z';

    const tileUrl = `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}/${layer}/${timestamp}.png?apikey=${TOMORROW_KEY}`;
    const tileRes = await fetch(tileUrl);
    if (!tileRes.ok) throw new Error(`Tile fetch failed: ${tileRes.status}`);
    const buf = await tileRes.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(buf));
  } catch(e) {
    console.error('Tile proxy error:', e.message);
    res.status(502).json({ error: 'Tile unavailable' });
  }
});

// ================================================================
//  TRAFFIC CAMERAS — 511 proxy (avoids CORS)
// ================================================================
const TRAFFIC_KEY = process.env.TRAFFIC_511_KEY || 'b044c1d8-d4a8-4823-abba-9e05b63e2f32';

app.get('/api/traffic-cams', async (req, res) => {
  const { state, q } = req.query;
  const cacheKey = `cams_${state}_${q}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    // 511 SF/CA/OR use the same base API
    const url = `https://api.511.org/traffic/cameras?api_key=${TRAFFIC_KEY}&format=json`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`511 API: ${r.status}`);

    let text = await r.text();
    // 511 sometimes returns JSONP — strip callback wrapper if present
    text = text.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
    const data = JSON.parse(text);

    const features = data?.features || data?.Elements || [];
    const searchTerm = (q || '').toLowerCase();

    const cams = features
      .filter(f => {
        const name = (f.properties?.Name || f.Name || '').toLowerCase();
        const road = (f.properties?.RoadwayName || f.RoadwayName || '').toLowerCase();
        return !searchTerm || name.includes(searchTerm) || road.includes(searchTerm);
      })
      .slice(0, 12)
      .map(f => ({
        name: f.properties?.Name || f.Name || 'Camera',
        road: f.properties?.RoadwayName || f.RoadwayName || '',
        img:  f.properties?.ImageUrl || f.ImageUrl || null,
        url:  f.properties?.Url || f.Url || null,
        lat:  f.geometry?.coordinates?.[1] || null,
        lng:  f.geometry?.coordinates?.[0] || null,
      }));

    cache.set(cacheKey, cams, 120); // 2 min cache
    res.json(cams);
  } catch(e) {
    console.warn('511 traffic cam error:', e.message);
    res.json([]); // return empty — frontend will show links fallback
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
    tomorrowIO: !!TOMORROW_KEY,
    uptime: Math.round(process.uptime()) + 's'
  });
});

app.get('/', (req, res) => res.json({ name: 'Storm Surge API', version: '1.0.0' }));

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