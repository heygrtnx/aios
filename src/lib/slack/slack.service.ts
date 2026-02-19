import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, lastValueFrom, map } from 'rxjs';
import * as crypto from 'crypto';

const SLACK_API_BASE = 'https://slack.com/api';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  private readonly config = {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
  };

  constructor(private readonly httpService: HttpService) {}

  /**
   * Sends a message to a Slack channel.
   * @param channel - Channel ID or name (e.g. C01234567)
   * @param text    - Message body
   * @param threadTs - Optional thread timestamp to reply inside a thread
   */
  async sendMessage(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<void> {
    const payload: Record<string, any> = { channel, text };
    if (threadTs) payload.thread_ts = threadTs;

    const response = this.httpService
      .post(`${SLACK_API_BASE}/chat.postMessage`, payload, this.config)
      .pipe(
        map((res) => {
          if (!res.data.ok) {
            this.logger.error(`Slack API error: ${res.data.error}`);
            throw new BadRequestException(`Slack API error: ${res.data.error}`);
          }
          return res.data;
        }),
        catchError((err) => {
          throw new BadRequestException(
            err?.message ?? 'Error sending Slack message',
          );
        }),
      );

    await lastValueFrom(response);
  }

  /**
   * Verifies a Slack request signature.
   * Prevents replay attacks (rejects timestamps older than 5 minutes).
   * https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifyRequest(
    signature: string,
    timestamp: string,
    rawBody: string,
  ): boolean {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      this.logger.warn('SLACK_SIGNING_SECRET not set — skipping verification');
      return true;
    }

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) {
      this.logger.warn(
        'Slack request timestamp too old — possible replay attack',
      );
      return false;
    }

    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto
      .createHmac('sha256', signingSecret)
      .update(baseString)
      .digest('hex');
    const expected = `v0=${hmac}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }
}
