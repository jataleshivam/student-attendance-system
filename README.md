# 🎓 Student Attendance System

### Using Face Recognition with Secure Admin Authentication & Session Security

A complete full-stack web application for managing student attendance with face recognition capabilities and enterprise-grade security.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** v16+ and npm
- **Python** 3.8+ (for face recognition)
- **Supabase** account (PostgreSQL database)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Edit `.env` file with your credentials:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
JWT_SECRET=your_secret_key
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_gmail_app_password
```

> **Gmail App Password**: Enable 2-Step Verification on your Google account, then generate an App Password at https://myaccount.google.com/apppasswords

### 3. Setup Database
Run the SQL in `supabase_schema.sql` in your Supabase SQL Editor.

### 4. Start Server
```bash
npm start
```
Open: **http://localhost:3000**

---

## 🔐 Security Features

| Feature | Implementation |
|---------|---------------|
| Gmail-only signup | Email validation (@gmail.com) |
| Password hashing | bcrypt (12 salt rounds) |
| Email verification | OTP via Gmail SMTP |
| Two-Factor Auth | Login OTP verification |
| JWT Authentication | Token-based API protection |
| Session timeout | 10-minute auto-logout |
| Back-button prevention | History API + popstate |
| Cache prevention | No-cache headers on all pages |
| Protected routes | Auth middleware on all APIs |

---

## 📁 Project Structure

```
student-attendance-system/
├── frontend/           # HTML, CSS, JavaScript
│   ├── login.html, signup.html, verify-otp.html
│   ├── login-otp.html, forgot-password.html, reset-password.html
│   ├── dashboard.html, add-student.html, view-students.html
│   ├── mark-attendance.html, face-attendance.html, view-attendance.html
│   ├── css/style.css
│   └── js/script.js
├── backend/            # Node.js + Express
│   ├── server.js
│   ├── supabaseClient.js
│   ├── routes/ (authRoutes, studentRoutes, attendanceRoutes)
│   ├── middleware/authMiddleware.js
│   └── utils/ (generateOTP, sendEmail)
├── face_recognition/   # Python scripts
│   ├── capture_faces.py
│   ├── train_model.py
│   ├── recognize_faces.py
│   └── dataset/
├── .env
├── package.json
└── supabase_schema.sql
```

---

## 🧠 Face Recognition Setup

### Install Python dependencies:
```bash
pip install opencv-python numpy pandas face_recognition
```

### Workflow:
1. **Capture**: `python face_recognition/capture_faces.py <student_id> <name>`
2. **Train**: `python face_recognition/train_model.py`
3. **Recognize**: Use the "Face Attendance" page in the dashboard

---

## 📊 Database Tables

- **admin** - Admin users with email verification
- **students** - Student records (name, roll_no, department, email)
- **attendance** - Daily attendance (student_id, date, status)

---

## 🔄 Authentication Flow

```
Signup → Email OTP → Verify → Login → Login OTP → JWT Token → Dashboard
```

## Tech Stack
**Frontend**: HTML, CSS, JavaScript  
**Backend**: Node.js, Express.js  
**Database**: Supabase (PostgreSQL)  
**Face Recognition**: Python, OpenCV, face_recognition  
**Security**: bcrypt, JWT, Nodemailer, OTP Generator
