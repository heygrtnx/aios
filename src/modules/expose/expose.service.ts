import { Injectable } from '@nestjs/common';
import { AiService } from 'src/lib/ai/ai.service';

@Injectable()
export class ExposeService {
  constructor(private readonly aiService: AiService) {}

  async generateResponse(prompt: string) {
    return this.aiService.generateResponse(prompt);
  }

  isWebSearchEnabled(): boolean {
    return this.aiService.isWebSearchEnabled();
  }

  async searchWeb(prompt: string): Promise<string | null> {
    return this.aiService.searchWeb(prompt);
  }

  streamResponse(
    prompt: string,
    searchContext?: string | null,
  ): { fullStream: AsyncIterable<any> } {
    return this.aiService.streamResponse(prompt, searchContext);
  }
}
