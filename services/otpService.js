import User from '../models/User.js';
import { sendEmail } from './emailService.js';

// OTP expiration time (10 minutes)
const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN = 60; // seconds

export const generateAndSendOtp = async (email, name) => {
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      throw new Error('User not found');
    }

    // Check if OTP was recently sent
    if (user.emailVerification?.lastSentAt) {
      const timeSinceLastOtp = Date.now() - new Date(user.emailVerification.lastSentAt).getTime();
      const cooldownRemaining = OTP_RESEND_COOLDOWN * 1000 - timeSinceLastOtp;
      
      if (cooldownRemaining > 0) {
        const seconds = Math.ceil(cooldownRemaining / 1000);
        throw new Error(`Please wait ${seconds} seconds before requesting a new OTP`);
      }
    }

    // Generate and save OTP
    const otp = user.generateEmailOtp();
    await user.save();

    // Send OTP via email
    await sendEmail(email, 'otpVerification', { otp, name });

    return {
      success: true,
      message: 'OTP sent successfully',
      cooldown: OTP_RESEND_COOLDOWN
    };
  } catch (error) {
    console.error('OTP generation error:', error);
    throw error;
  }
};

export const verifyOtp = async (email, enteredOtp) => {
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      throw new Error('User not found');
    }

    const result = user.verifyEmailOtp(enteredOtp);
    
    if (result.success) {
      await user.save();
      
      // Send welcome email
      try {
        await sendEmail(email, 'welcome', { name: user.name });
      } catch (emailError) {
        console.error('Welcome email failed:', emailError);
        // Don't throw error as OTP verification was successful
      }
    }

    return result;
  } catch (error) {
    console.error('OTP verification error:', error);
    throw error;
  }
};

export const canResendOtp = async (email) => {
  try {
    const user = await User.findOne({ email });
    
    if (!user || !user.emailVerification?.lastSentAt) {
      return { canResend: true, remainingTime: 0 };
    }

    const timeSinceLastOtp = Date.now() - new Date(user.emailVerification.lastSentAt).getTime();
    const cooldownRemaining = OTP_RESEND_COOLDOWN * 1000 - timeSinceLastOtp;

    return {
      canResend: cooldownRemaining <= 0,
      remainingTime: Math.max(0, Math.ceil(cooldownRemaining / 1000))
    };
  } catch (error) {
    console.error('OTP resend check error:', error);
    throw error;
  }
};

export const isOtpExpired = (expiresAt) => {
  return Date.now() > new Date(expiresAt).getTime();
};