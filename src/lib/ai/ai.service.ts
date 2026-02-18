import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { generateText, streamText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

import { systemPrompt as SYSTEM_PROMPT } from './sp';
import { createDbTool } from './tools/db.tool';
import { webSearch } from '@valyu/ai-sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly gateway;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    /**
     * Correct modern usage:
     * baseURL is NOT required.
     * SDK automatically uses the correct gateway endpoint.
     */
    this.gateway = createGateway({
      apiKey: this.configService.get<string>('AI_GATEWAY_API_KEY'),
    });
  }

  private getTools() {
    const tools: Record<string, ReturnType<typeof webSearch> | ReturnType<typeof createDbTool>> = {
      database: createDbTool(this.prisma),
    };
    if (this.configService.get<string>('VALYU_API_KEY')) {
      tools.webSearch = webSearch({});
    }
    return tools;
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
        tools: this.getTools(),
        stopWhen: stepCountIs(5),
      });

      return result.text;
    } catch (error) {
      this.logger.error('AI Gateway error', error);
      throw error;
    }
  }

  /** Returns a stream of text chunks; avoids leaking the SDK's internal return type. */
  streamResponse(userPrompt: string): { textStream: AsyncIterable<string> } {
    const model =
      this.configService.get<string>('AI_MODEL') ??
      'anthropic/claude-sonnet-4.5';

    const result = streamText({
      model: this.gateway(model),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools: this.getTools(),
      stopWhen: stepCountIs(5),
    });

    return { textStream: result.textStream };
  }
}
