@echo off
title Uploading Student Attendance System to GitHub
color 0b
echo ====================================================================
echo   🚀 STUDENT ATTENDANCE SYSTEM - AUTO GITHUB UPLOADER
echo ====================================================================
echo.
echo This script will securely push all code folders (backend, frontend, 
echo models) from your computer to your GitHub repository:
echo https://github.com/jataleshivam/student-attendance-system
echo.
echo --------------------------------------------------------------------
echo ℹ️  IF A GITHUB LOGIN POPUP OPENS:
echo    Please complete the login in your browser to authorize the upload.
echo --------------------------------------------------------------------
echo.
echo Pushing code to GitHub...
echo.

"C:\Users\hp\AppData\Local\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd\git.exe" push origin main --force

echo.
if %errorlevel% neq 0 (
    color 0c
    echo ❌ ERROR: Push failed.
    echo Please make sure:
    echo 1. You are connected to the internet.
    echo 2. You have permission to write to this GitHub repository.
) else (
    color 0a
    echo ════════════════════════════════════════════════════════════════════
    echo   ✅ SUCCESS! All files and folders have been uploaded to GitHub!
    echo ════════════════════════════════════════════════════════════════════
    echo.
    echo 🔄 NEXT STEP:
    echo 1. Go to your Render Dashboard (https://dashboard.render.com).
    echo 2. Open your "student-attendance-system" Web Service.
    echo 3. Click "Manual Deploy" at the top right.
    echo 4. Select "Clear Build Cache and Deploy".
    echo 5. Render will compile and launch your live website in a few minutes!
)
echo.
echo Press any key to close this window...
pause > null
