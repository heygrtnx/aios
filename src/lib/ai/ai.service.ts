import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { generateText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

import { systemPrompt as SYSTEM_PROMPT } from './sp';

import { webSearch } from '@valyu/ai-sdk';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly gateway;

  constructor(private readonly configService: ConfigService) {
    /**
     * Correct modern usage:
     * baseURL is NOT required.
     * SDK automatically uses the correct gateway endpoint.
     */
    this.gateway = createGateway({
      apiKey: this.configService.get<string>('AI_GATEWAY_API_KEY'),
    });
  }

  async generateResponse(userPrompt: string): Promise<string> {
    try {
      const model =
        this.configService.get<string>('AI_MODEL') ??
        'anthropic/claude-sonnet-4.5';

      const result = await generateText({
        model: this.gateway(model),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        tools: {
          webSearch: webSearch({}),
        },
        stopWhen: stepCountIs(5),
      });

      return result.text;
    } catch (error) {
      this.logger.error('AI Gateway error', error);
      throw error;
    }
  }
}
