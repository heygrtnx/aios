import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LibModule } from '../lib/lib.module';
import { CustomLoggerService } from '../lib/loggger/logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LibModule,
  ],
  controllers: [AppController],
  providers: [AppService, CustomLoggerService],
})
export class AppModule {}
