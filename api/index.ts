import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app/app.module';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as moment from 'moment-timezone';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AllExceptionsFilter } from '../src/middleware';
import { CustomLoggerService } from '../src/lib/loggger/logger.service';

const server = express();
let isReady = false;

async function bootstrap(): Promise<void> {
  if (isReady) return;

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: false,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const productionUrl = configService.get<string>('PRODUCTION_URL');
  const developmentUrl = configService.get<string>('DEVELOPMENT_URL');
  const appUrl = configService.get<string>('PLATFORM_URL');
  const platform = configService.get<string>('PLATFORM_NAME');
  const logger = app.get(CustomLoggerService);

  server.use(express.json({ limit: '10kb' }));

  app.setGlobalPrefix('v1');

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  moment.tz.setDefault('Africa/Lagos');

  server.set('trust proxy', 1);

  app.useGlobalFilters(new AllExceptionsFilter(logger));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5000,
    }),
  );

  const allowedOrigins: (string | RegExp)[] = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  ];

  [productionUrl, developmentUrl, appUrl]
    .filter((u): u is string => !!u)
    .map((u) => u.replace(/\/$/, ''))
    .forEach((origin) => allowedOrigins.push(origin));

  const extraOrigins = configService.get<string>('CORS_ORIGINS');
  if (extraOrigins) {
    extraOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((origin) => allowedOrigins.push(origin));
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: 'GET,PATCH,POST,PUT,DELETE,OPTIONS',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      stopAtFirstError: true,
      transform: true,
      whitelist: false,
    }),
  );

  const swaggerOptions = new DocumentBuilder()
    .setTitle(`${platform} API`)
    .setDescription(`API Documentation for ${platform} API`)
    .setVersion('1.0.0')
    .addServer(`http://localhost:${port}`, 'Local environment')
    .addServer(`https://${developmentUrl}`, 'Development environment')
    .addServer(`https://${productionUrl}`, 'Production environment')
    .addBearerAuth(
      { type: 'http', scheme: 'Bearer', bearerFormat: 'JWT' },
      'Authorization',
    )
    .addTag('Server', 'Endpoint for Server functions')
    .addTag('Expose', 'Endpoint for Expose functions')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerOptions);
  server.get('/v1/docs-json', (_req, res) => res.json(swaggerDocument));
  SwaggerModule.setup('v1/swagger', app, swaggerDocument);
  server.use(
    '/v1/docs',
    apiReference({
      spec: { url: '/v1/docs-json' },
      theme: 'default',
      pageTitle: `${platform} API`,
    }),
  );

  await app.init();
  isReady = true;
}

export default async (req: any, res: any): Promise<void> => {
  await bootstrap();
  server(req, res);
};
