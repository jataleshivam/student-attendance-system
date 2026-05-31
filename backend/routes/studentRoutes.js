const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ============================================
// POST /api/students/add
// ============================================
router.post('/add', async (req, res) => {
  try {
    const { name, roll_no, department, email } = req.body;

    // Validate input
    if (!name || !roll_no || !department) {
      return res.status(400).json({
        success: false,
        message: 'Name, Roll Number, and Department are required.'
      });
    }

    // Check duplicate roll_no
    const { data: existing } = await supabase
      .from('students')
      .select('id')
      .eq('roll_no', roll_no)
      .single();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A student with this roll number already exists.'
      });
    }

    // Insert student
    const { data, error } = await supabase
      .from('students')
      .insert([{ name, roll_no, department, email: email || null }])
      .select();

    if (error) {
      console.error('Add student DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(201).json({
      success: true,
      message: 'Student added successfully!',
      data: data[0]
    });

  } catch (error) {
    console.error('Add student error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/students/all
// ============================================
router.get('/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('roll_no', { ascending: true });

    if (error) {
      console.error('Get students DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(200).json({
      success: true,
      data: data || [],
      count: (data || []).length
    });

  } catch (error) {
    console.error('Get students error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// DELETE /api/students/:id
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Student ID is required.' });
    }

    // Delete related attendance first
    await supabase
      .from('attendance')
      .delete()
      .eq('student_id', id);

    // Delete student
    const { error } = await supabase
      .from('students')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete student DB error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Student deleted successfully!'
    });

  } catch (error) {
    console.error('Delete student error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/students/dataset
// Lists all students and their respective face dataset image paths for in-browser recognition
// ============================================
router.get('/dataset', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const datasetDir = path.join(__dirname, '..', '..', 'dataset');
    
    if (!fs.existsSync(datasetDir)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const folders = fs.readdirSync(datasetDir);
    const studentData = [];

    for (const folder of folders) {
      const folderPath = path.join(datasetDir, folder);
      if (fs.statSync(folderPath).isDirectory() && !folder.startsWith('.')) {
        const files = fs.readdirSync(folderPath);
        const images = files.filter(f => f.lowerCase ? f.lowerCase().endsWith('.jpg') || f.lowerCase().endsWith('.jpeg') || f.lowerCase().endsWith('.png') : f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.png'));
        
        if (images.length > 0) {
          studentData.push({
            label: folder,
            imageUrls: images.slice(0, 5).map(img => `/dataset/${folder}/${img}`) // Load up to 5 reference images for performance and high accuracy
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: studentData
    });

  } catch (error) {
    console.error('Get student dataset error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
