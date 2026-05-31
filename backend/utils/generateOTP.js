const otpGenerator = require('otp-generator');

/**
 * Generate a 6-digit numeric OTP
 * @returns {string} 6-digit OTP
 */
const generateOTP = () => {
  return otpGenerator.generate(6, {
    digits: true,
    lowerCaseAlphabets: false,
    upperCaseAlphabets: false,
    specialChars: false
  });
};

/**
 * Get OTP expiry time (5 minutes from now)
 * @returns {Date} Expiry timestamp
 */
const getOTPExpiry = () => {
  return new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
};

module.exports = { generateOTP, getOTPExpiry };
