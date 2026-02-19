import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as moment from 'moment-timezone';

const WINDOW_TZ = 'Africa/Lagos';
const MAX_PROMPTS_PER_DAY = 3;

@Injectable()
export class OpenAccessPromptLimitGuard implements CanActivate {
  private readonly store = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const env = this.configService.get<string>('ENVIRONMENT');
    const apiKey = this.configService.get<string>('API_KEY');
    const role = this.configService.get<string>('ROLE');

    if (env !== 'production' || apiKey || role === 'admin') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ip = (request.ip || request.socket?.remoteAddress || 'unknown').trim();
    const dateKey = moment().tz(WINDOW_TZ).format('YYYY-MM-DD');
    const key = `${ip}:${dateKey}`;

    const count = this.store.get(key) ?? 0;
    if (count >= MAX_PROMPTS_PER_DAY) {
      throw new HttpException(
        `Open access limit: maximum ${MAX_PROMPTS_PER_DAY} prompts per day per device.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.store.set(key, count + 1);
    return true;
  }
}
