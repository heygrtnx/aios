import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { generateText, streamText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

import { systemPrompt as SYSTEM_PROMPT } from './sp';
import { createDbTool } from './tools/db.tool';
import { webSearch } from '@valyu/ai-sdk';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_AI_MODEL = 'openai/gpt-3.5-turbo';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly gateway;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.gateway = createGateway({
      apiKey: this.configService.get<string>('AI_GATEWAY_API_KEY'),
    });
    this.logger.log(`AI model activated: ${this.getModel()}`);
  }

  private getTools() {
    const tools: Record<string, any> = {
      database: createDbTool(this.prisma),
    };
    if (this.isWebSearchEnabled()) {
      tools.webSearch = webSearch({ maxNumResults: 5, fastMode: true });
    }
    return tools;
  }

  private getModel(): string {
    const env = this.configService.get<string>('AI_MODEL')?.trim();
    return env && env.length > 0 ? env : DEFAULT_AI_MODEL;
  }

  isWebSearchEnabled(): boolean {
    return !!this.configService.get<string>('VALYU_API_KEY');
  }

  /** Searches the web and returns formatted context, or null if not configured / failed. */
  async searchWeb(query: string): Promise<string | null> {
    if (!this.isWebSearchEnabled()) return null;

    try {
      const tool = webSearch({ maxNumResults: 5, fastMode: true });
      const results: any = await (tool as any).execute(
        { query },
        { toolCallId: 'pre-search', messages: [] },
      );

      if (!results?.results?.length) return null;

      const formatted = (results.results as any[])
        .slice(0, 5)
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? '').slice(0, 800)}`,
        )
        .join('\n\n');

      return `<web_search_results>\nQuery: ${query}\n\n${formatted}\n</web_search_results>`;
    } catch (err: any) {
      this.logger.warn(
        'Web search failed, continuing without context',
        err?.message,
      );
      return null;
    }
  }

  async generateResponse(userPrompt: string): Promise<string> {
    return this.generateResponseWithHistory([
      { role: 'user', content: userPrompt },
    ]);
  }

  async generateResponseWithHistory(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    try {
      const model = this.getModel();
      this.logger.log(`Using model: ${model}`);

      const result = await generateText({
        model: this.gateway(model),
        system: SYSTEM_PROMPT,
        messages,
        tools: this.getTools(),
        stopWhen: stepCountIs(5),
      });

      return result.text;
    } catch (error) {
      this.logger.error('AI Gateway error', error);
      throw error;
    }
  }

  /** Returns the full event stream for SSE with conversation history. */
  streamResponseWithHistory(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): { fullStream: AsyncIterable<any> } {
    const model = this.getModel();
    this.logger.log(`Using model: ${model}`);

    const result = streamText({
      model: this.gateway(model),
      system: SYSTEM_PROMPT,
      messages,
      tools: this.getTools(),
      stopWhen: stepCountIs(5),
    });

    return { fullStream: result.fullStream };
  }
}
