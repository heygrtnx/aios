import { Injectable } from '@nestjs/common';
import { AiService } from 'src/lib/ai/ai.service';

@Injectable()
export class ExposeService {
  constructor(private readonly aiService: AiService) {}

  async generateResponse(prompt: string) {
    return this.aiService.generateResponse(prompt);
  }

  streamResponse(prompt: string): { fullStream: AsyncIterable<any> } {
    return this.aiService.streamResponse(prompt);
  }
}
