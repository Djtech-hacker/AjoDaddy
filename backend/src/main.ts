import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// ── Fix BigInt JSON serialization ─────────────────────────────
(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // ── Security middleware ────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        },
      },
      crossOriginEmbedderPolicy: false,
      // Deny all framing — prevents clickjacking attacks where the admin
      // panel is embedded invisibly inside a malicious page to trick an
      // admin into clicking a real button (e.g. "ban user") unknowingly.
      frameguard: { action: 'deny' },
      // Only takes effect over HTTPS in production — harmless on localhost,
      // but forces browsers to always use HTTPS once deployed, preventing
      // an attacker from downgrading a connection to plain HTTP.
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    }),
  );

  app.use(cookieParser());

  // ── CORS ───────────────────────────────────────────────────
  // ALLOWED_ORIGINS supports a comma-separated list, so adding a second
  // origin later (e.g. admin.paypaddy.com) is just an env change — no
  // code change needed. Falls back to FRONTEND_URL for backward compat,
  // then to localhost as a last resort for local dev.
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  });

  // ── Global prefix ──────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Global pipes ───────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global filters & interceptors ──────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ── Swagger API docs ───────────────────────────────────────
  // NOTE: when you deploy, make sure NODE_ENV is set to "production" —
  // otherwise this exposes a full interactive map of every endpoint,
  // including every admin route, with a "try it out" button against
  // your live API, to anyone who finds the URL.
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PayPaddy API')
      .setDescription('PayPaddy — African Fintech Contribution Platform')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger docs available at /api/docs');
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`🚀 PayPaddy API running on port ${port}`);
  logger.log(`📍 Environment: ${process.env.NODE_ENV}`);
}

bootstrap();