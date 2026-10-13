const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'mytube-secret-key-2024-xyz';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const F = {
  users: path.join(DATA_DIR, 'users.json'),
  videos: path.join(DATA_DIR, 'videos.json'),
  comments: path.join(DATA_DIR, 'comments.json'),
  chats: path.join(DATA_DIR, 'chats.json'),
  follows: path.join(DATA_DIR, 'follows.json')
};

function load(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

let users = load(F.users, []);
let videos = load(F.videos, []);
let comments = load(F.comments, []);
let chats = load(F.chats, []);
let follows = load(F.follows, []);

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (r, f, cb) => cb(null, UPLOAD_DIR),
  filename: (r, f, cb) => {
    const ext = path.extname(f.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'No token' });
  try { req.userId = jwt.verify(t, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function optAuth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (t) { try { req.userId = jwt.verify(t, JWT_SECRET).id; } catch {} }
  next();
}
function pubUser(u) {
  return {
    id: u.id, name: u.name, gmail: u.gmail, region: u.region,
    bio: u.bio || '', joined: u.joined,
    followers: follows.filter(f => f.followingId === u.id).length,
    following: follows.filter(f => f.followerId === u.id).length
  };
}

app.post('/api/register', async (req, res) => {
  const { name, gmail, password, region } = req.body;
  if (!name || !gmail || !password || !region) return res.status(400).json({ error: 'အားလုံး ဖြည့်ပါ' });
  if (users.find(u => u.gmail.toLowerCase() === gmail.toLowerCase())) return res.status(400).json({ error: 'Gmail ရှိပြီးသား' });
  const hash = await bcrypt.hash(password, 10);
  const u = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name, gmail, region, password: hash, bio: '', joined: Date.now()
  };
  users.push(u); save(F.users, users);
  const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, user: pubUser(u) });
});

app.post('/api/login', async (req, res) => {
  const { gmail, password } = req.body;
  const u = users.find(x => x.gmail.toLowerCase() === gmail.toLowerCase());
  if (!u) return res.status(400).json({ error: 'Gmail မတွေ့' });
  if (!await bcrypt.compare(password, u.password)) return res.status(400).json({ error: 'Password မှား' });
  const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, user: pubUser(u) });
});

app.get('/api/me', auth, (req, res) => {
  const u = users.find(x => x.id === req.userId);
  if (!u) return res.status(404).json({ error: 'မတွေ့' });
  res.json(pubUser(u));
});

app.put('/api/me', auth, (req, res) => {
  const u = users.find(x => x.id === req.userId);
  if (req.body.name) u.name = req.body.name.trim().slice(0, 30);
  if (req.body.bio !== undefined) u.bio = req.body.bio.trim().slice(0, 200);
  save(F.users, users);
  res.json(pubUser(u));
});

app.get('/api/users', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  let list = users.filter(u => u.id !== req.userId);
  if (q) list = list.filter(u => u.name.toLowerCase().includes(q) || u.gmail.toLowerCase().includes(q));
  res.json(list.slice(0, 50).map(u => {
    const isFollowing = follows.some(f => f.followerId === req.userId && f.followingId === u.id);
    return { ...pubUser(u), isFollowing };
  }));
});

app.get('/api/users/:id', auth, (req, res) => {
  const u = users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'မတွေ့' });
  const isFollowing = follows.some(f => f.followerId === req.userId && f.followingId === u.id);
  res.json({ ...pubUser(u), isFollowing });
});

app.post('/api/users/:id/follow', auth, (req, res) => {
  const tId = req.params.id;
  if (tId === req.userId) return res.status(400).json({ error: 'ကိုယ့်ကိုယ် follow မလုပ်နိုင်' });
  if (!users.find(u => u.id === tId)) return res.status(404).json({ error: 'User မတွေ့' });
  const i = follows.findIndex(f => f.followerId === req.userId && f.followingId === tId);
  if (i >= 0) {
    follows.splice(i, 1); save(F.follows, follows);
    res.json({ following: false });
  } else {
    follows.push({ followerId: req.userId, followingId: tId, date: Date.now() });
    save(F.follows, follows);
    res.json({ following: true });
  }
});

app.get('/api/feed', optAuth, (req, res) => {
  const list = videos.map(v => {
    const u = users.find(x => x.id === v.userId);
    return {
      id: v.id, userId: v.userId, title: v.title, filename: v.filename,
      size: v.size, duration: v.duration, views: v.views || 0,
      likes: (v.likedBy || []).length, likedBy: v.likedBy || [],
      date: v.date, userName: u ? u.name : 'User',
      commentCount: comments.filter(c => c.videoId === v.id).length
    };
  }).sort((a, b) => b.date - a.date);
  res.json(list);
});

app.get('/api/feed/following', auth, (req, res) => {
  const ids = follows.filter(f => f.followerId === req.userId).map(f => f.followingId);
  const list = videos.filter(v => ids.includes(v.userId)).map(v => {
    const u = users.find(x => x.id === v.userId);
    return {
      id: v.id, userId: v.userId, title: v.title, filename: v.filename,
      size: v.size, duration: v.duration, views: v.views || 0,
      likes: (v.likedBy || []).length, likedBy: v.likedBy || [],
      date: v.date, userName: u ? u.name : 'User',
      commentCount: comments.filter(c => c.videoId === v.id).length
    };
  }).sort((a, b) => b.date - a.date);
  res.json(list);
});

app.get('/api/videos/user/:uid', auth, (req, res) => {
  const list = videos.filter(v => v.userId === req.params.uid).map(v => {
    const u = users.find(x => x.id === v.userId);
    return {
      id: v.id, userId: v.userId, title: v.title, filename: v.filename,
      size: v.size, duration: v.duration, views: v.views || 0,
      likes: (v.likedBy || []).length, likedBy: v.likedBy || [],
      date: v.date, userName: u ? u.name : 'User',
      commentCount: comments.filter(c => c.videoId === v.id).length
    };
  }).sort((a, b) => b.date - a.date);
  res.json(list);
});

app.get('/api/videos/mine', auth, (req, res) => {
  res.json(videos.filter(v => v.userId === req.userId).sort((a, b) => b.date - a.date));
});

app.post('/api/videos', auth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File မပါ' });
  const v = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    userId: req.userId, title: req.body.title || 'Untitled',
    filename: req.file.filename, size: req.file.size,
    duration: parseFloat(req.body.duration) || 0,
    views: 0, likedBy: [], date: Date.now()
  };
  videos.push(v); save(F.videos, videos);
  res.json(v);
});

app.delete('/api/videos/:id', auth, (req, res) => {
  const i = videos.findIndex(v => v.id === req.params.id && v.userId === req.userId);
  if (i === -1) return res.status(404).json({ error: 'မတွေ့' });
  const fp = path.join(UPLOAD_DIR, videos[i].filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  videos.splice(i, 1); save(F.videos, videos);
  comments = comments.filter(c => c.videoId !== req.params.id);
  save(F.comments, comments);
  res.json({ ok: true });
});

app.post('/api/videos/:id/view', (req, res) => {
  const v = videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'မတွေ့' });
  v.views = (v.views || 0) + 1; save(F.videos, videos);
  res.json({ views: v.views });
});

app.post('/api/videos/:id/like', auth, (req, res) => {
  const v = videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'မတွေ့' });
  if (!v.likedBy) v.likedBy = [];
  const i = v.likedBy.indexOf(req.userId);
  if (i >= 0) v.likedBy.splice(i, 1);
  else v.likedBy.push(req.userId);
  save(F.videos, videos);
  res.json({ likes: v.likedBy.length, liked: i < 0 });
});

app.get('/api/videos/:id/comments', (req, res) => {
  const list = comments.filter(c => c.videoId === req.params.id)
    .sort((a, b) => a.date - b.date)
    .map(c => {
      const u = users.find(x => x.id === c.userId);
      return { ...c, userName: u ? u.name : 'User' };
    });
  res.json(list);
});

app.post('/api/videos/:id/comments', auth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment ထည့်ပါ' });
  const c = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    videoId: req.params.id, userId: req.userId,
    text: text.slice(0, 500), date: Date.now()
  };
  comments.push(c); save(F.comments, comments);
  const u = users.find(x => x.id === req.userId);
  res.json({ ...c, userName: u.name });
});

app.get('/api/chats', auth, (req, res) => {
  const my = chats.filter(c => c.from === req.userId || c.to === req.userId);
  const byUser = {};
  my.forEach(c => {
    const o = c.from === req.userId ? c.to : c.from;
    if (!byUser[o] || byUser[o].date < c.date) byUser[o] = c;
  });
  const list = Object.keys(byUser).map(uid => {
    const u = users.find(x => x.id === uid);
    const unread = my.filter(c => c.from === uid && c.to === req.userId && !c.read).length;
    return {
      userId: uid, userName: u ? u.name : 'User',
      lastMsg: byUser[uid].text, date: byUser[uid].date, unread
    };
  }).sort((a, b) => b.date - a.date);
  res.json(list);
});

app.get('/api/chats/unread', auth, (req, res) => {
  res.json({ unread: chats.filter(c => c.to === req.userId && !c.read).length });
});

app.get('/api/chats/:uid', auth, (req, res) => {
  const list = chats.filter(c =>
    (c.from === req.userId && c.to === req.params.uid) ||
    (c.from === req.params.uid && c.to === req.userId)
  ).sort((a, b) => a.date - b.date);
  list.forEach(c => { if (c.to === req.userId && !c.read) c.read = true; });
  save(F.chats, chats);
  res.json(list);
});

app.post('/api/chats/:uid', auth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'စာ ထည့်ပါ' });
  const c = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    from: req.userId, to: req.params.uid,
    text: text.slice(0, 1000), date: Date.now(), read: false
  };
  chats.push(c); save(F.chats, chats);
  res.json(c);
});

app.listen(PORT, () => console.log('🎬 MyTube running on ' + PORT));
