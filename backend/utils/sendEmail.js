const nodemailer = require('nodemailer');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// Create Gmail SMTP transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Send OTP email
 * @param {string} to - Recipient email
 * @param {string} otp - OTP code
 * @param {string} purpose - Purpose of OTP (signup, login, reset)
 */
const sendOTPEmail = async (to, otp, purpose = 'verification') => {
  const subjects = {
    signup: '🔐 Email Verification - Student Attendance System',
    login: '🔑 Login Verification OTP - Student Attendance System',
    reset: '🔄 Password Reset OTP - Student Attendance System'
  };

  const titles = {
    signup: 'Verify Your Email',
    login: 'Login Verification',
    reset: 'Reset Your Password'
  };

  const messages = {
    signup: 'Thank you for signing up! Please use the following OTP to verify your email address.',
    login: 'A login attempt was made on your account. Please use the following OTP to complete your login.',
    reset: 'We received a request to reset your password. Please use the following OTP to proceed.'
  };

  const mailOptions = {
    from: `"Student Attendance System" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subjects[purpose] || subjects.signup,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:0; background-color:#0f0f23; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
        <div style="max-width:500px; margin:40px auto; background:linear-gradient(135deg,#1a1a2e,#16213e); border-radius:16px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#667eea,#764ba2); padding:30px; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:24px;">🎓 Student Attendance System</h1>
          </div>
          <!-- Body -->
          <div style="padding:40px 30px; text-align:center;">
            <h2 style="color:#e2e8f0; margin:0 0 10px;">${titles[purpose] || titles.signup}</h2>
            <p style="color:#94a3b8; font-size:14px; line-height:1.6; margin:0 0 30px;">
              ${messages[purpose] || messages.signup}
            </p>
            <!-- OTP Box -->
            <div style="background:linear-gradient(135deg,#667eea22,#764ba222); border:2px solid #667eea; border-radius:12px; padding:20px; margin:0 auto 30px; max-width:280px;">
              <p style="color:#94a3b8; font-size:12px; margin:0 0 8px; text-transform:uppercase; letter-spacing:2px;">Your OTP Code</p>
              <h1 style="color:#667eea; font-size:36px; margin:0; letter-spacing:8px; font-weight:700;">${otp}</h1>
            </div>
            <p style="color:#64748b; font-size:12px; margin:0;">
              ⏰ This OTP will expire in <strong style="color:#f59e0b;">5 minutes</strong>
            </p>
          </div>
          <!-- Footer -->
          <div style="padding:20px 30px; border-top:1px solid #ffffff10; text-align:center;">
            <p style="color:#475569; font-size:11px; margin:0;">
              If you did not request this, please ignore this email.<br>
              © 2024 Student Attendance System
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    // Check if using default placeholder credentials or if credentials are empty
    const isPlaceholder = !process.env.EMAIL_USER || 
                          process.env.EMAIL_USER === 'admin@gmail.com' || 
                          process.env.EMAIL_USER.includes('your_gmail') ||
                          !process.env.EMAIL_PASS ||
                          process.env.EMAIL_PASS === 'admin123';

    if (isPlaceholder) {
      console.log('\n============================================================');
      console.log(' ⚠️   DEVELOPMENT FALLBACK ACTIVE (Placeholder SMTP)   ⚠️');
      console.log(` 📧  Simulated OTP Email to: \x1b[36m${to}\x1b[0m`);
      console.log(` 📝  Purpose: \x1b[35m${purpose.toUpperCase()}\x1b[0m`);
      console.log(` 🔑  YOUR OTP CODE IS: \x1b[32;1m${otp}\x1b[0m`);
      console.log('============================================================');
      console.log(' 👉  Copy this OTP code and paste it in the web page.');
      console.log(' 👉  To send real emails, set your Gmail & App Password in .env\n');
      return { success: true, fallback: true };
    }

    const info = await transporter.sendMail(mailOptions);
    console.log('📧 OTP Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email send error:', error);
    
    // Print the OTP to console so the developer/tester is not blocked
    console.log('\n============================================================');
    console.log(' ⚠️   DEVELOPMENT FALLBACK ACTIVE (SMTP Send Failed)   ⚠️');
    console.log(` 📧  Attempted OTP Email to: \x1b[36m${to}\x1b[0m`);
    console.log(` 📝  Purpose: \x1b[35m${purpose.toUpperCase()}\x1b[0m`);
    console.log(` 🔑  YOUR OTP CODE IS: \x1b[32;1m${otp}\x1b[0m`);
    console.log(` ❌  Error Details: ${error.message}`);
    console.log('============================================================');
    console.log(' 👉  Copy this OTP code and paste it in the web page.');
    console.log(' 👉  To send real emails, set your Gmail & App Password in .env\n');

    // To prevent blocking local testing, we return success so local operations work
    return { success: true, fallback: true, error: error.message };
  }
};

module.exports = { sendOTPEmail };
