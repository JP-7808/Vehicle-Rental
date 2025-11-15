import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),          // 587
    secure: process.env.EMAIL_SECURE === 'true',   // false for STARTTLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // Render sometimes needs longer timeout
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     10_000,
    // Force STARTTLS (Gmail requires it on 587)
    requireTLS: true,
    // Debug (remove in prod)
    // logger: true,
    // debug: true,
  });

  return transporter;
};

// Email templates
const emailTemplates = {
  otpVerification: (otp, name) => ({
    subject: 'Verify Your Email - Vehicle Rental Service',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; }
          .header { background: #3b82f6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .otp-code { font-size: 32px; font-weight: bold; color: #3b82f6; text-align: center; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Vehicle Rental Service</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Thank you for registering with our vehicle rental service. Use the OTP below to verify your email address:</p>
            <div class="otp-code">${otp}</div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't create an account, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Vehicle Rental Service. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  passwordReset: (resetUrl, name) => ({
    subject: 'Password Reset Request - Vehicle Rental Service',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; }
          .header { background: #ef4444; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>You requested to reset your password. Click the button below to create a new password:</p>
            <p style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>This link will expire in 15 minutes.</p>
            <p>If you didn't request this reset, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Vehicle Rental Service. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  welcome: (name) => ({
    subject: 'Welcome to Vehicle Rental Service!',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; }
          .header { background: #10b981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome Aboard!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Welcome to Vehicle Rental Service! Your account has been successfully verified and is now active.</p>
            <p>You can now start exploring our wide range of vehicles and make bookings.</p>
            <p>If you have any questions, feel free to contact our support team.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Vehicle Rental Service. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  })
};

// Send email function
export const sendEmail = async (to, templateName, data) => {
  try {
    const transporter = createTransporter();

    // Verify once at startup (optional)
    await transporter.verify();
    console.log('SMTP transporter verified');

    const template = emailTemplates[templateName](
      data.otp ?? data.resetUrl,
      data.name
    );

    const mailOptions = {
      from: `"Vehicle Rental Service" <${process.env.EMAIL_FROM}>`,
      to,
      subject: template.subject,
      html: template.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent →', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Email sending error:', err);
    throw new Error('Failed to send email');
  }
};

// Verify transporter
export const verifyEmailTransporter = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email transporter verified successfully');
    return true;
  } catch (error) {
    console.error('Email transporter verification failed:', error);
    return false;
  }
};