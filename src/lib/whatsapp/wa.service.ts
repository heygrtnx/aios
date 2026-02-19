import { BadRequestException, Injectable } from '@nestjs/common';
import { catchError, lastValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class WhatsappService {
  private readonly url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_API_VERSION}/${process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID}/messages`;
  private readonly config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_API_ACCESS_TOKEN}`,
    },
  };

  constructor(private readonly httpService: HttpService) {}

  /** Marks the incoming message as read AND shows the typing indicator in one call. */
  async sendReadWithTyping(messageID: string): Promise<void> {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageID,
      typing_indicator: { type: 'text' },
    });

    const response = this.httpService.post(this.url, data, this.config).pipe(
      map((res) => res.data),
      catchError(() => {
        throw new BadRequestException('Error sending typing indicator');
      }),
    );

    await lastValueFrom(response);
  }

  async sendMessage(
    to: string,
    messageID: string,
    text: string,
  ): Promise<void> {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      context: { message_id: messageID },
      type: 'text',
      text: { preview_url: false, body: text },
    });

    const response = this.httpService.post(this.url, data, this.config).pipe(
      map((res) => res.data),
      catchError(() => {
        throw new BadRequestException('Error sending WhatsApp message');
      }),
    );

    await lastValueFrom(response);
  }
}
