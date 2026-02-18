import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment-timezone';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as express from 'express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './middleware';
import { CustomLoggerService } from './lib/loggger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const productionUrl = configService.get<string>('PRODUCTION_URL');
  const developmentUrl = configService.get<string>('DEVELOPMENT_URL');
  const appUrl = configService.get<string>('PLATFORM_URL');
  const platform = configService.get<string>('PLATFORM_NAME');
  const logger = app.get(CustomLoggerService);
  const apiKeyEnabled = !!configService.get<string>('API_KEY');

  app.use(express.json({ limit: '10kb' }));

  const expressApp = app.getHttpAdapter().getInstance() as express.Application;
  expressApp.use(express.static('public'));

  app.setGlobalPrefix('v1');

  app.use(helmet());

  moment.tz.setDefault('Africa/Lagos');

  expressApp.set('trust proxy', 1);

  app.useGlobalFilters(new AllExceptionsFilter(logger));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5000,
    }),
  );

  const allowedOrigins = [/^http:\/\/localhost:\d+$/];
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

  SwaggerModule.setup('v1/docs', app, swaggerDocument, {
    customSiteTitle: `${platform} API`,
    swaggerOptions: {
      explorer: false,
      defaultModelsExpandDepth: -1,
      docExpansion: 'list',
      defaultModelRendering: 'model',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      displayRequestDuration: true,
      jsonEditor: true,
      useUnsafeSource: true,
      deepLinking: true,
    },
    customCss: `
      .swagger-ui .topbar { display: none; }
    `,
  });

  try {
    await app.listen(port);
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Swagger available at http://localhost:${port}/v1/docs`);
    console.log(
      `API Key Auth: ${apiKeyEnabled ? 'ENABLED (x-api-key header required)' : 'DISABLED (open access)'}`,
    );
  } catch (err) {
    console.error('Error starting server', err);
  }
}
bootstrap();
