const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../supabaseClient');
const { generateOTP, getOTPExpiry } = require('../utils/generateOTP');
const { sendOTPEmail } = require('../utils/sendEmail');
const authMiddleware = require('../middleware/authMiddleware');

// ============================================
// POST /api/auth/signup
// ============================================
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Validate fields
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    // Gmail only
    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({ success: false, message: 'Only Gmail accounts (@gmail.com) are allowed.' });
    }

    // Password match
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    // Password strength
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    // Check if email exists
    const { data: existing } = await supabase
      .from('admin')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert admin
    const { data, error } = await supabase
      .from('admin')
      .insert([{
        username,
        email,
        password: hashedPassword,
        is_verified: true, // Auto-verify
      }])
      .select();

    if (error) {
      console.error('Signup DB error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create account.' });
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully! You can now login.',
      email
    });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, message: 'Server error during signup.' });
  }
});

// ============================================
// POST /api/auth/verify-otp
// ============================================
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    // Get admin
    const { data: admin, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Check OTP
    if (admin.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // Check expiry
    if (new Date() > new Date(admin.otp_expiry)) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // Activate account
    const { error: updateError } = await supabase
      .from('admin')
      .update({ is_verified: true, otp: null, otp_expiry: null })
      .eq('email', email);

    if (updateError) {
      return res.status(500).json({ success: false, message: 'Failed to verify account.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now login.'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
});

// ============================================
// POST /api/auth/resend-otp
// ============================================
router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    // Get admin
    const { data: admin, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    // Update OTP in DB
    await supabase
      .from('admin')
      .update({ otp, otp_expiry: otpExpiry.toISOString() })
      .eq('email', email);

    // Send OTP
    await sendOTPEmail(email, otp, purpose || 'signup');

    return res.status(200).json({
      success: true,
      message: 'New OTP sent to your email.'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // Get admin
    const { data: admin, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Generate JWT token immediately (skipping OTP)
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        username: admin.username
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// ============================================
// POST /api/auth/login-otp
// ============================================
router.post('/login-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    // Get admin
    const { data: admin, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Check OTP
    if (admin.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // Check expiry
    if (new Date() > new Date(admin.otp_expiry)) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please login again.' });
    }

    // Clear OTP
    await supabase
      .from('admin')
      .update({ otp: null, otp_expiry: null })
      .eq('email', email);

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        username: admin.username
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email
      }
    });

  } catch (error) {
    console.error('Login OTP error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// POST /api/auth/forgot-password
// ============================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    // Check if admin exists
    const { data: admin, error } = await supabase
      .from('admin')
      .select('id, email')
      .eq('email', email)
      .single();

    if (error || !admin) {
      // Don't reveal if email exists
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, an OTP has been sent.'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    // Store OTP
    await supabase
      .from('admin')
      .update({ otp, otp_expiry: otpExpiry.toISOString() })
      .eq('email', email);

    // Send OTP
    await sendOTPEmail(email, otp, 'reset');

    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, an OTP has been sent.',
      email
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// POST /api/auth/reset-password
// ============================================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    // Get admin
    const { data: admin, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Verify OTP
    if (admin.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    if (new Date() > new Date(admin.otp_expiry)) {
      return res.status(400).json({ success: false, message: 'OTP has expired.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    const { error: updateError } = await supabase
      .from('admin')
      .update({
        password: hashedPassword,
        otp: null,
        otp_expiry: null
      })
      .eq('email', email);

    if (updateError) {
      return res.status(500).json({ success: false, message: 'Failed to reset password.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================
// GET /api/auth/verify-token
// ============================================
router.get('/verify-token', authMiddleware, (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Token is valid.',
    user: req.admin
  });
});

module.exports = router;
