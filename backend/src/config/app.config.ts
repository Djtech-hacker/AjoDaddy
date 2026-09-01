export default () => ({
  app: {
    nodeEnv:     process.env.NODE_ENV || 'development',
    port:        parseInt(process.env.PORT, 10) || 4000,
    frontendUrl: process.env.FRONTEND_URL,
    name:        process.env.APP_NAME || 'PayPaddy',
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret:             process.env.JWT_SECRET,
    refreshSecret:      process.env.JWT_REFRESH_SECRET,
    expiresIn:          process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn:   process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  paystack: {
    secretKey:      process.env.PAYSTACK_SECRET_KEY,
    publicKey:      process.env.PAYSTACK_PUBLIC_KEY,
    webhookSecret:  process.env.PAYSTACK_WEBHOOK_SECRET,
    baseUrl:        'https://api.paystack.co',
  },
  flutterwave: {
    secretKey:      process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey:      process.env.FLUTTERWAVE_PUBLIC_KEY,
    webhookSecret:  process.env.FLUTTERWAVE_WEBHOOK_SECRET,
    encryptionKey:  process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    baseUrl:        'https://api.flutterwave.com/v3',
  },
  cloudinary: {
    cloudName:  process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:     process.env.CLOUDINARY_API_KEY,
    apiSecret:  process.env.CLOUDINARY_API_SECRET,
  },
  resend: {
    apiKey:    process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM || 'noreply@paypaddy.io',
  },
  google: {
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl:  process.env.GOOGLE_CALLBACK_URL,
  },
  security: {
    bcryptRounds:         parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    pinSaltRounds:        parseInt(process.env.TRANSACTION_PIN_SALT_ROUNDS, 10) || 12,
  },
});
