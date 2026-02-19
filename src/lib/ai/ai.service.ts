import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { generateText, streamText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

import { systemPrompt as SYSTEM_PROMPT } from './sp';
import { createDbTool } from './tools/db.tool';
import { webSearch } from '@valyu/ai-sdk';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4.5';

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
    this.logger.log(`AI model activated: ${this.getModel()}`);
  }

  private getTools() {
    const tools: Record<
      string,
      ReturnType<typeof webSearch> | ReturnType<typeof createDbTool>
    > = {
      database: createDbTool(this.prisma),
    };
    if (this.configService.get<string>('VALYU_API_KEY')) {
      tools.webSearch = webSearch({});
    }
    return tools;
  }

  private getModel(): string {
    const env = this.configService.get<string>('AI_MODEL')?.trim();
    return env && env.length > 0 ? env : DEFAULT_AI_MODEL;
  }

  async generateResponse(userPrompt: string): Promise<string> {
    try {
      const model = this.getModel();
      this.logger.log(`Using model: ${model}`);

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

  /** Returns the full event stream (text deltas, tool calls, results, etc.) for SSE. */
  streamResponse(userPrompt: string): { fullStream: AsyncIterable<any> } {
    const model = this.getModel();
    this.logger.log(`Using model: ${model}`);

    const result = streamText({
      model: this.gateway(model),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools: this.getTools(),
      stopWhen: stepCountIs(5),
    });

    return { fullStream: result.fullStream };
  }
}
