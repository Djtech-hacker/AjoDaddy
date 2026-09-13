import * as Joi from 'joi';

export function validate(config: Record<string, unknown>) {
  const schema = Joi.object({
    NODE_ENV:                Joi.string().valid('development', 'production', 'test').default('development'),
    PORT:                    Joi.number().default(4000),
    FRONTEND_URL:            Joi.string().uri().required(),
    DATABASE_URL:            Joi.string().required(),
    JWT_SECRET:              Joi.string().min(32).required(),
    JWT_REFRESH_SECRET:      Joi.string().min(32).required(),
    JWT_EXPIRES_IN:          Joi.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN:  Joi.string().default('7d'),
    REDIS_URL:               Joi.string().required(),
    PAYSTACK_SECRET_KEY:     Joi.string().required(),
    PAYSTACK_PUBLIC_KEY:     Joi.string().required(),
    PAYSTACK_WEBHOOK_SECRET: Joi.string().required(),
    FLUTTERWAVE_SECRET_KEY:  Joi.string().optional(),
    CLOUDINARY_CLOUD_NAME:   Joi.string().required(),
    CLOUDINARY_API_KEY:      Joi.string().required(),
    CLOUDINARY_API_SECRET:   Joi.string().required(),
    RESEND_API_KEY:          Joi.string().optional(),
    EMAIL_FROM:              Joi.string().email().required(),
    BCRYPT_ROUNDS:           Joi.number().default(12),
    MAILJET_API_KEY:    Joi.string().optional(),
    MAILJET_SECRET_KEY: Joi.string().optional(),
  }).unknown(true);

  const { error, value } = schema.validate(config, { abortEarly: false });
  if (error) {
    throw new Error(`❌ Environment validation failed:\n${error.message}`);
  }
  return value;
}
