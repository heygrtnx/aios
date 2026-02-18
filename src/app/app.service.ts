import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getHello(): string {
    return 'Hello World!';
  }

  getBranding(): { authorName: string | null; authorUrl: string | null } {
    return {
      authorName: this.configService.get<string>('AUTHOR_NAME') ?? null,
      authorUrl: this.configService.get<string>('AUTHOR_URL') ?? null,
    };
  }
}
