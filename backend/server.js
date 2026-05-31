const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import routes
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers - prevent caching of protected pages
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
  }
  next();
});

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Serve student face dataset statically for in-browser recognition
app.use('/dataset', express.static(path.join(__dirname, '..', 'dataset')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);

// Root route - redirect to login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

// Catch-all for undefined routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🎓 Student Attendance System');
  console.log('  🔐 With Secure Admin Authentication');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  ✅ Server running on: http://localhost:${PORT}`);
  console.log(`  📁 Frontend served from: ${path.join(__dirname, '..', 'frontend')}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
});
