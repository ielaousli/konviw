import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';
import Config from './config/config';

async function bootstrap() {
  // as we need to access the Express API
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // logger: ['error', 'warn'];
  const config = app.get(ConfigService);
  const basePath = config.get<Config>('web.basePath');
  app.useGlobalPipes(
    // Reference: https://docs.nestjs.com/techniques/validation#auto-validation
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      disableErrorMessages: true,
      validationError: {
        value: true,
      },
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.setGlobalPrefix(`${basePath}`);
  app.disable('x-powered-by');
  app.enableCors();

  app.useStaticAssets(join(__dirname, '..', '/static'), {
    prefix: `${basePath}`,
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
