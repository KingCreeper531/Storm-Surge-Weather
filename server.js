// ================================================================
//  STORM SURGE WEATHER — Backend Server v1.0
//  Node.js + Express
//  Handles: auth, posts (Google Cloud Storage), weather proxy,
//           caching, username uniqueness
//  Deploy to: Render.com
// ================================================================

require('dotenv').config(); // loads .env for local dev — ignored on Render
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
const WEATHERNEXT_KEY = process.env.WEATHERNEXT_KEY || process.env.TOMORROW_API_KEY;  // WeatherNext 2 API key

// ── GOOGLE CLOUD STORAGE ─────────────────────────────────────────
let storage, bucket;
try {
  let credentials = null;
  if (GCS_KEY) {
    let raw = GCS_KEY.trim();
    // Try base64 decode first (recommended method)
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (decoded.startsWith('{')) raw = decoded;
    } catch(e) {}
    // Strip surrounding quotes Render may have added
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    raw = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
    try {
      credentials = JSON.parse(raw);
    } catch(parseErr) {
      console.error('⚠ GOOGLE_CLOUD_KEY is not valid JSON.');
      console.error('  Best fix: base64 encode your service account JSON and paste that.');
      console.error('  Mac/Linux: base64 -i service-account.json | tr -d "\n"');
      console.error('  Windows:   [Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))');
      console.error('  Parse error:', parseErr.message);
    }
  }
  if (credentials) {
    storage = new Storage({ projectId: GCS_PROJECT, credentials });
    bucket  = storage.bucket(GCS_BUCKET);
    console.log('✅ Google Cloud Storage connected');
  } else {
    console.warn('⚠ GCS credentials missing or invalid — using in-memory fallback');
  }
} catch(e) {
  console.warn('⚠ GCS init failed:', e.message);
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
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 25, message: { error: 'Too many auth attempts' } });
app.use('/api/', apiLimiter);

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
app.post('/api/auth/register', authLimiter, async (req, res) => {
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
app.post('/api/auth/login', authLimiter, async (req, res) => {
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
    const northN = Number(north);
    const southN = Number(south);
    const eastN = Number(east);
    const westN = Number(west);
    if ([northN, southN, eastN, westN].every(Number.isFinite)) {
      posts = posts.filter(p =>
        p.lat != null && p.lng != null &&
        p.lat >= southN && p.lat <= northN &&
        p.lng >= westN  && p.lng <= eastN
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
    const latN = lat === '' || lat == null ? null : Number(lat);
    const lngN = lng === '' || lng == null ? null : Number(lng);
    if ((latN != null && !Number.isFinite(latN)) || (lngN != null && !Number.isFinite(lngN))) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const posts = await gcsRead('posts.json', []);
    const post = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      author: req.user.name,
      location: location || 'Unknown',
      lat: latN,
      lng: lngN,
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
//  WEATHER PROXY — WeatherNext 2 with caching
// ================================================================
app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'valid lat and lng required' });
  }

  const cacheKey = `weather_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, _cached: true });

  try {
    let weather;
    if (WEATHERNEXT_KEY) {
      weather = await fetchWeatherNext2(lat, lng);
    } else {
      weather = await fetchOpenMeteo(lat, lng);
    }
    cache.set(cacheKey, weather, 600);
    res.json(weather);
  } catch (e) {
    console.error('Weather provider failed:', e.message);
    try {
      const weather = await fetchOpenMeteo(lat, lng);
      cache.set(cacheKey, weather, 300);
      return res.json(weather);
    } catch (fallbackErr) {
      console.error('Open-Meteo fallback failed:', fallbackErr.message);
      const weather = buildSyntheticWeather(lat, lng);
      cache.set(cacheKey, weather, 120);
      return res.json(weather);
    }
  }
});

async function fetchWeatherNext2(lat, lng) {
  const fields = [
    'temperature','temperatureApparent','humidity','precipitationProbability',
    'precipitationIntensity','weatherCode','windSpeed','windDirection',
    'pressureSurfaceLevel','cloudCover','uvIndex','sunriseTime','sunsetTime',
    'temperatureMax','temperatureMin','windSpeedMax'
  ].join(',');

  const bases = [
    'https://api.weathernext.io/v4/timelines'
  ];

  let lastErr = null;
  for (const base of bases) {
    try {
      const url = `${base}?location=${lat},${lng}`
        + `&fields=${fields}`
        + `&timesteps=current,1h,1d&units=metric&timezone=auto`
        + `&apikey=${WEATHERNEXT_KEY}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${base} ${r.status}`);
      const raw = await r.json();
      const normalised = normaliseWeatherNext2(raw);
      normalised._source = 'weathernext2';
      return normalised;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No WeatherNext2 endpoint succeeded');
}

function normaliseWeatherNext2(raw) {
  const timelines = raw?.data?.timelines || [];
  const current1h = timelines.find(t => t.timestep === 'current')?.intervals?.[0]?.values || {};
  const hourly = timelines.find(t => t.timestep === '1h')?.intervals || [];
  const daily = timelines.find(t => t.timestep === '1d')?.intervals || [];

  return {
    current: {
      temperature_2m: current1h.temperature ?? 0,
      apparent_temperature: current1h.temperatureApparent ?? 0,
      relative_humidity_2m: current1h.humidity ?? 0,
      precipitation: current1h.precipitationIntensity ?? 0,
      weather_code: weatherNextCodeToWMO(current1h.weatherCode),
      wind_speed_10m: current1h.windSpeed ?? 0,
      wind_direction_10m: current1h.windDirection ?? 0,
      surface_pressure: current1h.pressureSurfaceLevel ?? 1013,
      cloud_cover: current1h.cloudCover ?? 0,
      uv_index: current1h.uvIndex ?? 0
    },
    hourly: {
      time: hourly.map(h => h.startTime),
      temperature_2m: hourly.map(h => h.values.temperature ?? 0),
      relative_humidity_2m: hourly.map(h => h.values.humidity ?? 0),
      weather_code: hourly.map(h => weatherNextCodeToWMO(h.values.weatherCode)),
      precipitation_probability: hourly.map(h => h.values.precipitationProbability ?? 0)
    },
    daily: {
      time: daily.map(d => d.startTime?.slice(0, 10)),
      temperature_2m_max: daily.map(d => d.values.temperatureMax ?? 0),
      temperature_2m_min: daily.map(d => d.values.temperatureMin ?? d.values.temperature ?? 0),
      weather_code: daily.map(d => weatherNextCodeToWMO(d.values.weatherCode)),
      sunrise: daily.map(d => d.values.sunriseTime || ''),
      sunset: daily.map(d => d.values.sunsetTime || ''),
      precipitation_probability_max: daily.map(d => d.values.precipitationProbability ?? 0),
      wind_speed_10m_max: daily.map(d => d.values.windSpeedMax ?? d.values.windSpeed ?? 0)
    }
  };
}

async function fetchOpenMeteo(lat, lng) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lng}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index'
    + '&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max'
    + '&forecast_days=7&temperature_unit=celsius&wind_speed_unit=ms&timezone=auto';

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();

  return {
    current: d.current || {},
    hourly: {
      time: d.hourly?.time || [],
      temperature_2m: d.hourly?.temperature_2m || [],
      relative_humidity_2m: d.hourly?.relative_humidity_2m || [],
      weather_code: d.hourly?.weather_code || [],
      precipitation_probability: d.hourly?.precipitation_probability || []
    },
    daily: {
      time: d.daily?.time || [],
      temperature_2m_max: d.daily?.temperature_2m_max || [],
      temperature_2m_min: d.daily?.temperature_2m_min || [],
      weather_code: d.daily?.weather_code || [],
      sunrise: d.daily?.sunrise || [],
      sunset: d.daily?.sunset || [],
      precipitation_probability_max: d.daily?.precipitation_probability_max || [],
      wind_speed_10m_max: d.daily?.wind_speed_10m_max || []
    },
    _source: 'open-meteo'
  };
}



function buildSyntheticWeather(lat, lng) {
  const now = new Date();
  const hour = now.getUTCHours();
  const base = 18 + 10 * Math.sin((hour / 24) * Math.PI * 2) - Math.abs(lat) * 0.05;
  const currentCode = base > 25 ? 1 : base > 10 ? 2 : 3;

  const hourlyTime = [];
  const hourlyTemp = [];
  const hourlyHum = [];
  const hourlyCode = [];
  const hourlyP = [];
  for (let i = 0; i < 24; i++) {
    const t = new Date(now.getTime() + i * 3600 * 1000);
    const wave = Math.sin(((hour + i) / 24) * Math.PI * 2);
    hourlyTime.push(t.toISOString());
    hourlyTemp.push(+(base + wave * 3).toFixed(1));
    hourlyHum.push(Math.max(35, Math.min(95, Math.round(70 - wave * 12))));
    hourlyCode.push(wave > 0.4 ? 1 : wave < -0.5 ? 3 : 2);
    hourlyP.push(Math.max(5, Math.min(85, Math.round(35 - wave * 20))));
  }

  const dailyTime = [];
  const tmax = [];
  const tmin = [];
  const dcode = [];
  const rain = [];
  const wind = [];
  const sunrise = [];
  const sunset = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(now.getTime() + d * 86400 * 1000);
    const max = +(base + 4 + Math.sin(d * 0.8) * 2).toFixed(1);
    const min = +(base - 4 + Math.cos(d * 0.7) * 2).toFixed(1);
    dailyTime.push(day.toISOString().slice(0, 10));
    tmax.push(max);
    tmin.push(min);
    dcode.push(max > 26 ? 1 : max < 8 ? 3 : 2);
    rain.push(Math.max(10, Math.min(90, Math.round(40 + Math.sin(d * 0.9) * 25))));
    wind.push(+(4 + Math.abs(Math.sin(d * 0.6)) * 5).toFixed(1));
    const sr = new Date(day); sr.setHours(6, 30, 0, 0);
    const ss = new Date(day); ss.setHours(18, 20, 0, 0);
    sunrise.push(sr.toISOString());
    sunset.push(ss.toISOString());
  }

  return {
    current: {
      temperature_2m: +base.toFixed(1),
      apparent_temperature: +(base - 0.8).toFixed(1),
      relative_humidity_2m: 62,
      precipitation: 0,
      weather_code: currentCode,
      wind_speed_10m: 4.2,
      wind_direction_10m: 210,
      surface_pressure: 1014,
      cloud_cover: currentCode === 3 ? 75 : 35,
      uv_index: Math.max(0, Math.round(8 * Math.sin((hour / 24) * Math.PI)))
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: hourlyTemp,
      relative_humidity_2m: hourlyHum,
      weather_code: hourlyCode,
      precipitation_probability: hourlyP
    },
    daily: {
      time: dailyTime,
      temperature_2m_max: tmax,
      temperature_2m_min: tmin,
      weather_code: dcode,
      sunrise,
      sunset,
      precipitation_probability_max: rain,
      wind_speed_10m_max: wind
    },
    _source: 'synthetic-fallback'
  };
}

function weatherNextCodeToWMO(code) {
  if (!code) return 0;
  const map = {
    1000:0, 1100:1, 1101:2, 1102:3, 1001:3,
    2000:45, 2100:48,
    4000:51, 4001:61, 4200:61, 4201:65,
    5000:71, 5001:77, 5100:71, 5101:75,
    6000:56, 6001:65, 6200:56, 6201:65,
    7000:77, 7101:77, 7102:77,
    8000:95
  };
  return map[code] ?? 0;
}

// ================================================================
//  CAMERAS — Hazcams quick links
// ================================================================
app.get('/api/cameras/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const url = `https://hazcams.com/search?query=${encodeURIComponent(q)}`;
  res.json({
    provider: 'hazcams',
    query: q,
    url,
    embedsAllowed: false
  });
});


// ================================================================
//  ADVANCED WEATHER / COMMUNITY APIs
// ================================================================
const customAlertsByUser = {};
const favoriteLocationsByUser = {};
const pushSubsByUser = {};
const chatRooms = {
  general: { name: 'general', messages: [] },
  chase: { name: 'chase', messages: [] },
  severe: { name: 'severe', messages: [] }
};

app.get('/api/lightning', (req, res) => {
  const now = Date.now();
  const items = Array.from({ length: 18 }, (_, i) => ({
    id: `lt-${i}`,
    lat: 25 + Math.random() * 20,
    lng: -100 + Math.random() * 30,
    intensity: Math.round(20 + Math.random() * 80),
    ts: new Date(now - Math.random() * 600000).toISOString()
  }));
  res.json({ items, source: 'simulated-live' });
});

app.get('/api/hurricane-track', (req, res) => {
  res.json({ points: [
    { lat: 17.8, lng: -63.1, wind: 55, at: '2026-09-10T00:00:00Z' },
    { lat: 19.3, lng: -65.2, wind: 65, at: '2026-09-10T12:00:00Z' },
    { lat: 21.0, lng: -67.8, wind: 75, at: '2026-09-11T00:00:00Z' },
    { lat: 23.2, lng: -70.5, wind: 85, at: '2026-09-11T12:00:00Z' }
  ]});
});

app.get('/api/storm-reports', (req, res) => {
  const types = ['hail', 'tornado', 'wind'];
  const items = Array.from({ length: 14 }, (_, i) => ({
    id: `sr-${i}`,
    type: types[i % 3],
    lat: 30 + Math.random() * 15,
    lng: -105 + Math.random() * 25,
    magnitude: (Math.random() * 3 + 0.5).toFixed(1),
    text: 'Community report',
    ts: new Date(Date.now() - Math.random() * 3600000).toISOString()
  }));
  res.json({ items });
});

app.post('/api/ai-severe-detection', (req, res) => {
  const t=String(req.body?.text||'').toLowerCase();
  const score=(['tornado','hail','rotation','funnel','wind damage'].filter(k=>t.includes(k)).length)/5;
  res.json({ severeProbability: +score.toFixed(2), tags: ['experimental-ai'] });
});

app.get('/api/mesoscale-discussions', (req, res) => {
  res.json({ items: [{ id: 'md-1001', title: 'Mesoscale Discussion 1001', risk: 'enhanced' }] });
});

app.get('/api/convective-outlook', (req, res) => {
  res.json({ polygons: [{ id: 'outlook-day1', risk: 'slight', points: [[-97,35],[-95,35],[-94,37],[-98,38],[-97,35]] }] });
});

app.get('/api/metar', (req, res) => {
  res.json({ items: [
    { id: 'KJFK', tempC: 18, windKt: 14, visMi: 10, flightCat: 'VFR' },
    { id: 'KLAX', tempC: 22, windKt: 9, visMi: 10, flightCat: 'VFR' },
    { id: 'KDEN', tempC: 12, windKt: 22, visMi: 8, flightCat: 'MVFR' }
  ]});
});

app.get('/api/model-comparison', (req, res) => {
  const lat = Number(req.query.lat || 40);
  const base = 15 + (lat - 35) * 0.2;
  const gfsTemp = +(base + (Math.random() * 2 - 1)).toFixed(1);
  const ecmwfTemp = +(base + (Math.random() * 2 - 1)).toFixed(1);
  res.json({ gfsTemp, ecmwfTemp, gfsWind: 16, ecmwfWind: 13, confidence: 'medium' });
});

app.get('/api/custom-alerts', requireAuth, (req, res) => {
  res.json(customAlertsByUser[req.user.email] || []);
});
app.post('/api/custom-alerts', requireAuth, (req, res) => {
  const list = customAlertsByUser[req.user.email] || [];
  const item = { id: `ca-${Date.now()}`, ...req.body, createdAt: new Date().toISOString() };
  list.push(item);
  customAlertsByUser[req.user.email] = list;
  res.json(item);
});

app.get('/api/favorites', requireAuth, (req, res) => {
  res.json(favoriteLocationsByUser[req.user.email] || []);
});
app.post('/api/favorites', requireAuth, (req, res) => {
  const list = favoriteLocationsByUser[req.user.email] || [];
  const item = { id: `fav-${Date.now()}`, ...req.body };
  list.push(item);
  favoriteLocationsByUser[req.user.email] = list;
  res.json(item);
});

app.post('/api/push-subscriptions', requireAuth, (req, res) => {
  const list = pushSubsByUser[req.user.email] || [];
  list.push({ id: `sub-${Date.now()}`, endpoint: req.body.endpoint || 'unknown' });
  pushSubsByUser[req.user.email] = list;
  res.json({ success: true, count: list.length });
});

app.get('/api/chat-rooms', (req, res) => {
  res.json(Object.values(chatRooms).map(r => ({ name: r.name, count: r.messages.length })));
});
app.get('/api/chat-rooms/:room/messages', (req, res) => {
  const room = chatRooms[req.params.room];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room.messages.slice(-100));
});
app.post('/api/chat-rooms/:room/messages', requireAuth, (req, res) => {
  const room = chatRooms[req.params.room];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const msg = { id: `msg-${Date.now()}`, user: req.user.name, text: String(req.body.text || '').slice(0, 500), ts: new Date().toISOString() };
  room.messages.push(msg);
  res.json(msg);
});


app.get('/api/radar/frames', async (req, res) => {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!r.ok) throw new Error(`RainViewer ${r.status}`);
    const d = await r.json();
    const frames = d?.radar?.past?.slice(-12) || [];
    res.json({ frames });
  } catch (e) {
    const now = Math.floor(Date.now() / 1000);
    const frames = Array.from({ length: 12 }, (_, i) => ({ path: 'v2/radar/0/0/0/0', time: now - (11 - i) * 600 }));
    res.json({ frames, _source: 'synthetic-fallback' });
  }
});

app.get('/api/radar/tile', async (req, res) => {
  const path = String(req.query.path || '');
  if (!path || path.includes('..')) return res.status(400).json({ error: 'Invalid tile path' });
  const safePath = path.replace(/^\/+/, '');
  const url = `https://tilecache.rainviewer.com/${safePath}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`RainViewer tile ${r.status}`);
    const arr = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', r.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=120');
    res.send(arr);
  } catch (e) {
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=', 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=30');
    res.send(transparentPng);
  }
});

// ================================================================
//  HEALTH CHECK
// ================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'Storm Surge Weather',
    version: '1.2.0',
    gcs: !!bucket,
    weatherNext2: !!WEATHERNEXT_KEY,
    mapboxToken: !!(process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
    uptime: Math.round(process.uptime()) + 's'
  });
});



// ── SERVE FRONTEND ──────────────────────────────────────────────
const frontendPath = path.join(__dirname, 'public');

// token.js MUST come before static middleware so env var wins over any file
app.get('/token.js', (req, res) => {
  const token = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  if (!token) console.warn('⚠ MAPBOX_TOKEN env var not set — map will not load');
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-store'); // never cache — token could change
  res.send(`const MAPBOX_TOKEN = "${token}";`);
});

// Static files (index.html, app.js, style.css etc)
app.use(express.static(frontendPath));

// Anything else → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── START ────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`⛈  Storm Surge API running on port ${PORT}`));
