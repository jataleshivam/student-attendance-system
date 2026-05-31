const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// All routes require authentication
router.use(authMiddleware);

// ============================================
// Local Face Attendance File Logger Helper
// ============================================
const FACE_LOG_FILE = path.join(__dirname, '..', 'data', 'face_attendance.json');

// Ensure the directory exists
const ensureLogDir = () => {
  const dir = path.dirname(FACE_LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Read local face logs
const readFaceLogs = () => {
  try {
    ensureLogDir();
    if (!fs.existsSync(FACE_LOG_FILE)) {
      return [];
    }
    const content = fs.readFileSync(FACE_LOG_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('Error reading face logs:', err);
    return [];
  }
};

// Write local face logs
const writeFaceLogs = (logs) => {
  try {
    ensureLogDir();
    fs.writeFileSync(FACE_LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing face logs:', err);
  }
};

// Log a student's face recognition
const logFaceAttendance = (student_id, date) => {
  const logs = readFaceLogs();
  const exists = logs.some(l => l.student_id === student_id && l.date === date);
  if (!exists) {
    logs.push({ student_id, date });
    writeFaceLogs(logs);
  }
};

// ============================================
// POST /api/attendance/save
// ============================================
router.post('/save', async (req, res) => {
  try {
    const { date, attendance } = req.body;

    if (!date || !attendance || !Array.isArray(attendance)) {
      return res.status(400).json({
        success: false,
        message: 'Date and attendance array are required.'
      });
    }

    // --- Server-side lock for past dates ---
    const todayStr = new Date().toISOString().split('T')[0];
    const isPastDate = date < todayStr;

    if (isPastDate) {
      // Fetch existing records for this date
      const { data: existingRecords, error: fetchErr } = await supabase
        .from('attendance')
        .select('student_id,status')
        .eq('date', date);

      if (fetchErr) {
        console.error('Error fetching existing attendance for past date:', fetchErr);
        return res.status(500).json({ success: false, message: fetchErr.message });
      }

      // Map existing records to student_id as strings for strict comparison
      const existingMap = new Map();
      if (existingRecords) {
        existingRecords.forEach(r => {
          existingMap.set(String(r.student_id), r.status);
        });
      }

      // Validate that no existing record's status is being changed
      for (const item of attendance) {
        const studentIdStr = String(item.student_id);
        if (existingMap.has(studentIdStr)) {
          const oldStatus = existingMap.get(studentIdStr);
          if (oldStatus !== item.status) {
            return res.status(400).json({
              success: false,
              message: `Attendance is locked for past date ${date} and cannot be modified.`
            });
          }
        }
      }
    }

    // Prepare records (no extra columns like is_face so database schema is untouched)
    const records = attendance.map(item => ({
      student_id: item.student_id,
      date: date,
      status: item.status
    }));

    // Upsert attendance records (inserts new records or updates existing ones on conflict of student_id and date)
    const { data, error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'student_id,date' })
      .select();

    if (error) {
      console.error('Save attendance DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(201).json({
      success: true,
      message: `Attendance saved for ${records.length} students!`,
      data
    });

  } catch (error) {
    console.error('Save attendance error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// POST /api/attendance/face
// Save face-recognized attendance for a single student
// ============================================
router.post('/face', async (req, res) => {
  try {
    const { student_id, date } = req.body;

    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required.'
      });
    }

    const attendanceDate = date || new Date().toISOString().split('T')[0];

    // Check duplicate attendance for today
    const { data: existing } = await supabase
      .from('attendance')
      .select('id')
      .eq('student_id', student_id)
      .eq('date', attendanceDate)
      .single();

    if (existing) {
      // In case record exists in DB but local log was missing, ensure it's logged
      logFaceAttendance(student_id, attendanceDate);

      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this student today.'
      });
    }

    // Insert attendance in standard table (no is_face column to avoid schema issues)
    const { data, error } = await supabase
      .from('attendance')
      .insert([{
        student_id,
        date: attendanceDate,
        status: 'Present'
      }])
      .select();

    if (error) {
      console.error('Face attendance DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Mark as face recognized in local file storage
    logFaceAttendance(student_id, attendanceDate);

    return res.status(201).json({
      success: true,
      message: 'Face attendance marked successfully!',
      data: data[0]
    });

  } catch (error) {
    console.error('Face attendance error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/attendance/all
// ============================================
router.get('/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        student_id,
        date,
        status,
        students (
          id,
          name,
          roll_no,
          department
        )
      `)
      .order('date', { ascending: false });

    if (error) {
      console.error('Get attendance DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Merge with local face log verified status
    const faceLogs = readFaceLogs();
    const recordsWithFace = (data || []).map(r => {
      const isFace = faceLogs.some(l => l.student_id === r.student_id && l.date === r.date);
      return { ...r, is_face: isFace };
    });

    return res.status(200).json({
      success: true,
      data: recordsWithFace
    });

  } catch (error) {
    console.error('Get attendance error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/attendance/date/:date
// ============================================
router.get('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        student_id,
        date,
        status,
        students (
          id,
          name,
          roll_no,
          department
        )
      `)
      .eq('date', date)
      .order('date', { ascending: false });

    if (error) {
      console.error('Get attendance by date DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Merge with local face log verified status
    const faceLogs = readFaceLogs();
    const recordsWithFace = (data || []).map(r => {
      const isFace = faceLogs.some(l => l.student_id === r.student_id && l.date === r.date);
      return { ...r, is_face: isFace };
    });

    return res.status(200).json({
      success: true,
      data: recordsWithFace
    });

  } catch (error) {
    console.error('Get attendance by date error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/attendance/today/count
// ============================================
router.get('/today/count', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('attendance')
      .select('id')
      .eq('date', today)
      .eq('status', 'Present');

    if (error) {
      console.error('Get today count DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(200).json({
      success: true,
      count: (data || []).length
    });

  } catch (error) {
    console.error('Get today count error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/attendance/start-face
// Trigger Python face recognition script
// ============================================
router.get('/start-face', async (req, res) => {
  try {
    const scriptPath = path.join(__dirname, '..', '..', 'fr_scripts', 'recognize_faces.py');
    const token = req.headers.authorization.split(' ')[1];

    exec(`py "${scriptPath}" ${token}`, (error, stdout, stderr) => {
      if (error) {
        console.error('Face recognition script error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to start face recognition.',
          error: stderr
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Face recognition completed.',
        output: stdout
      });
    });

  } catch (error) {
    console.error('Start face recognition error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
