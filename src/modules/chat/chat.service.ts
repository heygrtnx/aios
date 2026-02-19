import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { AiService, ChatMessage, Attachment } from 'src/lib/ai/ai.service';
import { WhatsappService } from 'src/lib/whatsapp/wa.service';
import { RedisService } from 'src/lib/redis/redis.service';
import { SlackService } from 'src/lib/slack/slack.service';
import { SendMailsService } from 'src/lib/email/sendMail.service';
import type { RfqData, RfqFollowup } from 'src/lib/ai/tools/rfq.tool';
import { ConfigService } from '@nestjs/config';

const HISTORY_LIMIT = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SLACK_EVENT_DEDUP_TTL = 300; // 5 minutes
const PRODUCT_UPLOAD_TTL = 60 * 60; // 1 hour
const CATALOG_TTL = 60 * 60 * 24 * 30; // 30 days

export type ProductCatalogEntry = {
  name: string;
  price: number | null;
  unit: string;
};
export type ProductCatalog = Record<string, ProductCatalogEntry>;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly whatsappService: WhatsappService,
    private readonly redisService: RedisService,
    private readonly slackService: SlackService,
    private readonly mailer: SendMailsService,
    private readonly configService: ConfigService,
  ) {}

  async generateResponse(prompt: string): Promise<string> {
    return this.aiService.generateResponse(prompt);
  }

  private static PRODUCT_FILE_EXTS = new Set(['csv', 'json', 'xlsx', 'xls']);
  private static PRODUCT_FILE_MIMES = new Set([
    'text/csv',
    'application/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]);

  private hashRows(rows: any[][]): string {
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  /**
   * Detects which column index corresponds to a concept by checking common header names.
   * Headers are normalized: lowercase, spaces/underscores removed.
   */
  private static detectColumnIndex(headers: string[], ...candidates: string[]): number {
    const normalized = headers.map((h) =>
      String(h).toLowerCase().replace(/[\s_\-]+/g, ''),
    );
    for (const c of candidates) {
      const idx = normalized.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /**
   * Builds a SKU→{name, price, unit} lookup map from parsed product rows.
   * Returns null if no usable SKU column is found.
   */
  static buildProductCatalog(rows: any[][]): ProductCatalog | null {
    if (rows.length < 2) return null;
    const headers = rows[0].map(String);

    const skuIdx = ChatService.detectColumnIndex(
      headers, 'sku', 'productid', 'itemcode', 'itemno', 'productcode',
      'code', 'partno', 'article', 'ref', 'reference', 'id',
    );
    if (skuIdx === -1) return null;

    const priceIdx = ChatService.detectColumnIndex(
      headers, 'price', 'unitprice', 'sellingprice', 'cost', 'rate',
      'amount', 'listprice', 'unitcost',
    );
    const nameIdx = ChatService.detectColumnIndex(
      headers, 'name', 'productname', 'itemname', 'description', 'title', 'label',
    );
    const unitIdx = ChatService.detectColumnIndex(
      headers, 'unit', 'uom', 'unitofmeasure', 'measure',
    );

    const catalog: ProductCatalog = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sku = String(row[skuIdx] ?? '').trim();
      if (!sku) continue;

      const rawPrice = priceIdx !== -1 ? row[priceIdx] : null;
      const price =
        rawPrice !== null && rawPrice !== '' && !isNaN(Number(rawPrice))
          ? Number(rawPrice)
          : null;

      catalog[sku.toUpperCase()] = {
        name: nameIdx !== -1 ? String(row[nameIdx] ?? '').trim() : sku,
        price,
        unit: unitIdx !== -1 ? String(row[unitIdx] ?? 'pcs').trim() : 'pcs',
      };
    }

    return Object.keys(catalog).length > 0 ? catalog : null;
  }

  /** Saves (or overwrites) the product catalog to Redis. */
  private async saveProductCatalog(rows: any[][]): Promise<void> {
    const catalog = ChatService.buildProductCatalog(rows);
    if (!catalog) return;
    await this.redisService.set('product-catalog', catalog, CATALOG_TTL);
    this.logger.log(`Product catalog saved — ${Object.keys(catalog).length} SKUs`);
  }

  /**
   * Returns an existing upload key if identical data is already stored,
   * otherwise creates a new one.
   */
  private async getOrCreateUploadKey(
    rows: any[][],
  ): Promise<{ uploadKey: string; alreadyExists: boolean }> {
    const hash = this.hashRows(rows);
    const hashKey = `product-upload-hash:${hash}`;

    const existingKey: string | null = await this.redisService.get(hashKey);
    if (existingKey) {
      const existingData = await this.redisService.get(
        `product-upload:${existingKey}`,
      );
      if (existingData) {
        // Always refresh catalog — it may have expired even if the upload key hasn't
        const catalogExists = await this.redisService.get('product-catalog');
        if (!catalogExists) {
          this.saveProductCatalog(rows).catch((e) =>
            this.logger.warn('Catalog refresh failed', e?.message),
          );
        }
        return { uploadKey: existingKey, alreadyExists: true };
      }
    }

    const uploadKey = randomUUID();
    await this.redisService.set(
      `product-upload:${uploadKey}`,
      rows,
      PRODUCT_UPLOAD_TTL,
    );
    await this.redisService.set(hashKey, uploadKey, PRODUCT_UPLOAD_TTL);

    // Persist price catalog for RFQ auto-lookup (non-blocking)
    this.saveProductCatalog(rows).catch((e) =>
      this.logger.warn('Catalog save failed', e?.message),
    );

    return { uploadKey, alreadyExists: false };
  }

  private isProductFile(mimeType: string, name: string): boolean {
    if (ChatService.PRODUCT_FILE_MIMES.has(mimeType)) return true;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ChatService.PRODUCT_FILE_EXTS.has(ext);
  }

  private extractPendingUploadKey(history?: ChatMessage[]): string | null {
    if (!history) return null;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === 'user') {
        const match = msg.content.match(/Upload key:\s*(\S+)/i);
        if (match) return match[1];
      }
    }
    return null;
  }

  async handleStreamPrompt(
    prompt: string,
    emit: (data: object) => void,
    history?: ChatMessage[],
    attachments?: Attachment[],
  ): Promise<void> {
    let finalPrompt = prompt;
    let finalAttachments = attachments;

    if (attachments?.length) {
      const productIdx = attachments.findIndex((att) =>
        this.isProductFile(att.mimeType, att.name),
      );

      if (productIdx !== -1) {
        const att = attachments[productIdx];
        try {
          const buffer = Buffer.from(att.data, 'base64');
          const { rows, columns } = this.parseProductFile({
            originalname: att.name,
            buffer,
            mimetype: att.mimeType,
          });

          const { uploadKey, alreadyExists } =
            await this.getOrCreateUploadKey(rows);

          if (alreadyExists) {
            this.logger.log(
              `Duplicate product file "${att.name}" — reusing upload key ${uploadKey}`,
            );
          }

          emit({ t: 'upload', uploadKey, rowCount: rows.length, columns, alreadyExists });

          const preview = rows
            .slice(0, Math.min(4, rows.length))
            .map((r) => r.join(' | '))
            .join('\n');

          finalPrompt =
            `[PRODUCT_UPLOAD]\n` +
            `File: "${att.name}"\n` +
            `Total rows: ${rows.length} (including header)\n` +
            `Upload key: ${uploadKey}\n` +
            `Columns: ${columns.join(', ')}\n\n` +
            `Preview:\n${preview}\n\n` +
            (prompt || 'I have uploaded a product file.');

          // Emit the effective prompt so the frontend can store it correctly in history.
          // Without this, subsequent turns won't have the uploadKey in context.
          emit({ t: 'user_content', content: finalPrompt });

          finalAttachments = attachments.filter((_, i) => i !== productIdx);
          if (finalAttachments.length === 0) finalAttachments = undefined;
        } catch (err: any) {
          this.logger.error('Failed to parse product file attachment', err);
        }
      }
    }

    // If this turn has no product upload but there is a pending upload key in
    // the conversation history, inject it directly into the current message so
    // the AI can reliably call uploadToSheet without having to parse history.
    if (!finalPrompt.startsWith('[PRODUCT_UPLOAD]')) {
      const pendingKey = this.extractPendingUploadKey(history);
      if (pendingKey) {
        finalPrompt = `[UPLOAD_KEY: ${pendingKey}]\n` + finalPrompt;
      }
    }

    const userMessage: ChatMessage = { role: 'user', content: finalPrompt };
    if (finalAttachments?.length) userMessage.attachments = finalAttachments;

    const messages: ChatMessage[] = [
      ...(history ?? []).slice(-HISTORY_LIMIT),
      userMessage,
    ];
    const { fullStream } = this.aiService.streamResponseWithHistory(messages);

    let textDeltaCount = 0;
    try {
      for await (const part of fullStream) {
        switch (part.type) {
          case 'text-delta':
            textDeltaCount++;
            emit({ t: 'text', v: part.text });
            break;
          case 'tool-call':
            this.logger.log(`Tool call: ${part.toolName}`);
            if (part.toolName === 'webSearch') {
              emit({ t: 'searching' });
            }
            break;
          case 'tool-result':
            this.logger.log(`Tool result: ${part.toolName}`);
            if (part.toolName === 'webSearch') {
              emit({ t: 'search_done' });
            }
            break;
          case 'reasoning-delta':
            emit({ t: 'reasoning', v: part.text });
            break;
          case 'finish':
            this.logger.log(
              `Stream finished — text deltas: ${textDeltaCount}, reason: ${part.finishReason}`,
            );
            emit({ t: 'done' });
            break;
          case 'error':
            this.logger.error(
              `Stream error event: ${JSON.stringify(part.error)}`,
            );
            break;
        }
      }
      if (textDeltaCount === 0) {
        this.logger.warn(
          'Stream finished with no text from the model. Check AI_GATEWAY_API_KEY and model.',
        );
      }
    } catch (err: any) {
      const msg =
        err?.message ??
        err?.cause?.message ??
        (typeof err?.cause?.responseBody === 'string'
          ? err.cause.responseBody
          : null) ??
        'Stream error';
      this.logger.error('Stream error', err?.stack ?? err);
      emit({ t: 'error', msg });
    }
  }

  async handleProductUpload(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    emit: (data: object) => void,
    history?: ChatMessage[],
  ): Promise<void> {
    const { rows, columns } = this.parseProductFile(file);

    const { uploadKey, alreadyExists } =
      await this.getOrCreateUploadKey(rows);

    if (alreadyExists) {
      this.logger.log(
        `Duplicate product file "${file.originalname}" — reusing upload key ${uploadKey}`,
      );
    }

    emit({ t: 'upload', uploadKey, rowCount: rows.length, columns, alreadyExists });

    const preview = rows
      .slice(0, Math.min(4, rows.length))
      .map((r) => r.join(' | '))
      .join('\n');

    const prompt =
      `[PRODUCT_UPLOAD]\n` +
      `File: "${file.originalname}"\n` +
      `Total rows: ${rows.length} (including header)\n` +
      `Upload key: ${uploadKey}\n` +
      `Columns: ${columns.join(', ')}\n\n` +
      `Preview:\n${preview}\n\n` +
      `I have uploaded a product file.`;

    await this.handleStreamPrompt(prompt, emit, history);
  }

  private parseProductFile(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
  }): { rows: any[][]; columns: string[] } {
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (ext === 'json') {
      const raw = JSON.parse(file.buffer.toString('utf-8'));
      const arr: Record<string, any>[] = Array.isArray(raw) ? raw : [raw];
      if (arr.length === 0) throw new Error('Empty JSON file');
      const columns = Object.keys(arr[0]);
      const rows = [
        columns,
        ...arr.map((item) => columns.map((col) => String(item[col] ?? ''))),
      ];
      return { rows, columns };
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
    }) as any[][];

    const filtered = jsonData.filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && cell !== ''),
    );

    if (filtered.length === 0) throw new Error('Empty file');

    const columns = filtered[0].map(String);
    const rows = filtered.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
    );
    return { rows, columns };
  }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verificationToken =
      process.env.WHATSAPP_CLOUD_API_WEBHOOK_VERIFICATION_TOKEN;

    if (mode === 'subscribe' && token === verificationToken) {
      return challenge;
    }

    return null;
  }

  async handleIncomingMessage(body: any): Promise<void> {
    const { messages } = body?.entry?.[0]?.changes?.[0]?.value ?? {};
    if (!messages) return;

    const message = messages[0];
    if (message.type !== 'text') return;

    const phoneNumber: string = message.from;
    const messageID: string = message.id;
    const userText: string = message.text.body;

    // Mark as read + show typing indicator
    await this.whatsappService.sendReadWithTyping(messageID);

    // Load history from Redis
    const historyKey = `chat:history:${phoneNumber}`;
    const history: ChatMessage[] =
      (await this.redisService.get(historyKey)) ?? [];

    // Build messages for AI (last N + new user message)
    const aiMessages: ChatMessage[] = [
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    // Generate response with history
    const aiResponse =
      await this.aiService.generateResponseWithHistory(aiMessages);

    // Persist updated history to Redis (with TTL)
    await this.redisService.set(
      historyKey,
      [...aiMessages, { role: 'assistant', content: aiResponse }],
      HISTORY_TTL_SECONDS,
    );

    // Send reply
    await this.whatsappService.sendMessage(phoneNumber, messageID, aiResponse);
  }

  handleSlackChallenge(challenge: string): { challenge: string } {
    return { challenge };
  }

  /** Renders an HTML quote page for a given quote number (for download). */
  async downloadQuote(quoteNumber: string): Promise<string | null> {
    const rfqData: RfqData | null = await this.redisService.get(
      `rfq:data:${quoteNumber}`,
    );
    if (!rfqData) return null;

    const platformName =
      this.configService.get<string>('PLATFORM_NAME') || 'Sales Team';

    const itemRows = rfqData.lineItems
      .map(
        (li) => `
        <tr>
          <td class="sku">${li.sku}</td>
          <td>${li.qty}</td>
          <td>${li.unit}</td>
          ${li.unitPrice != null ? `<td>$${li.unitPrice}</td><td>$${li.lineTotal!.toFixed(2)}</td>` : `<td class="tbd">TBD</td><td class="tbd">TBD</td>`}
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Quote ${rfqData.quoteNumber}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f9;color:#1a1a2e;padding:32px 16px}
  .page{max-width:780px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  .hdr{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;display:flex;justify-content:space-between;align-items:flex-start}
  .brand{color:#e2e8f0;font-size:22px;font-weight:700}
  .badge{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 16px;text-align:right}
  .badge .lbl{color:rgba(255,255,255,.6);font-size:11px;text-transform:uppercase;letter-spacing:1px}
  .badge .num{color:#fff;font-size:16px;font-weight:700;margin-top:2px}
  .meta{display:flex;gap:28px;margin-top:20px}
  .mi .lbl{color:rgba(255,255,255,.5);font-size:11px;text-transform:uppercase;letter-spacing:.8px}
  .mi .val{color:#e2e8f0;font-size:13px;margin-top:3px}
  .body{padding:36px 40px}
  .stitle{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:10px;font-weight:600}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 20px;margin-bottom:24px}
  .cname{font-size:15px;font-weight:700}
  .cdet{margin-top:5px;color:#64748b;font-size:13px;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead th{background:#1a1a2e;color:#e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:.8px;padding:10px 14px;text-align:left;font-weight:600}
  thead th:not(:first-child){text-align:right}
  tbody tr:nth-child(even){background:#f8fafc}
  tbody td{padding:11px 14px;font-size:14px;color:#334155;border-bottom:1px solid #f1f5f9}
  tbody td:not(:first-child){text-align:right}
  td.sku{font-weight:600;color:#1e293b}
  td.tbd{color:#94a3b8;font-style:italic}
  .total-row{display:flex;justify-content:flex-end;margin-bottom:28px}
  .total-box{background:#1a1a2e;border-radius:8px;padding:12px 24px;display:flex;gap:40px;align-items:center}
  .total-box .lbl{color:rgba(255,255,255,.6);font-size:11px;text-transform:uppercase;letter-spacing:1px}
  .total-box .amt{color:#fff;font-size:22px;font-weight:800}
  .notes{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:13px 18px;font-size:13px;color:#92400e;line-height:1.6;margin-bottom:24px}
  .ftr{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.7}
  .print-btn{display:block;margin:20px auto 0;padding:10px 28px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.3px}
  @media print{body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0}.print-btn{display:none}}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div>
      <div class="brand">${platformName}</div>
      <div class="meta">
        <div class="mi"><div class="lbl">Date</div><div class="val">${rfqData.quoteDate}</div></div>
        <div class="mi"><div class="lbl">Valid Until</div><div class="val">${rfqData.validUntil}</div></div>
        ${rfqData.deliveryDate ? `<div class="mi"><div class="lbl">Delivery</div><div class="val">${rfqData.deliveryDate}</div></div>` : ''}
      </div>
    </div>
    <div class="badge">
      <div class="lbl">Quote Reference</div>
      <div class="num">${rfqData.quoteNumber}</div>
    </div>
  </div>
  <div class="body">
    <div class="stitle">Bill To</div>
    <div class="card">
      <div class="cname">${rfqData.contactName}</div>
      <div class="cdet">
        ${rfqData.contactEmail ? rfqData.contactEmail + '<br/>' : ''}
        ${rfqData.contactPhone ?? ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:24px">
      <div class="stitle" style="margin-bottom:6px">Ship To</div>
      <div style="font-size:14px;font-weight:500;color:#1e293b">${rfqData.shipTo}</div>
    </div>
    <div class="stitle">Items</div>
    <table>
      <thead>
        <tr><th>Description / SKU</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Line Total</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="total-row">
      <div class="total-box">
        <div class="lbl">Grand Total</div>
        <div class="amt">${rfqData.hasAllPrices ? `$${rfqData.total}` : 'TBD'}</div>
      </div>
    </div>
    ${rfqData.notes ? `<div class="notes"><strong>Notes:</strong> ${rfqData.notes}</div>` : ''}
  </div>
  <div class="ftr">
    This quote is valid until <strong>${rfqData.validUntil}</strong>.<br/>
    Generated by <strong>${platformName}</strong>
  </div>
</div>
<button class="print-btn" onclick="window.print()">⬇ Save as PDF</button>
</body>
</html>`;
  }

  /**
   * Processes due RFQ follow-up emails.
   * Call this from an external cron/webhook — e.g. daily at 9 AM.
   */
  async triggerFollowups(): Promise<{ sent: number; errors: string[] }> {
    const today = new Date().toISOString().slice(0, 10);
    const platformName =
      this.configService.get<string>('PLATFORM_NAME') || 'Sales Team';

    const all = await this.redisService.getByPattern('rfq:followup:*');
    let sent = 0;
    const errors: string[] = [];

    for (const followup of Object.values(all) as RfqFollowup[]) {
      if (followup.status !== 'email_sent' || !followup.recipientEmail) continue;

      const rfqData: RfqData | null = await this.redisService.get(
        `rfq:data:${followup.quoteNumber}`,
      );
      if (!rfqData) continue;

      for (let i = 0; i < followup.followUpDates.length; i++) {
        if (followup.followUpSent[i]) continue;
        if (followup.followUpDates[i] > today) break; // dates are ordered

        try {
          await this.mailer.sendEmail(
            followup.recipientEmail,
            `Following up: Your Quote ${followup.quoteNumber}`,
            'rfqFollowup',
            {
              quoteNumber: rfqData.quoteNumber,
              validUntil: rfqData.validUntil,
              contactName: rfqData.contactName,
              lineItems: rfqData.lineItems,
              followUpDay: i + 1,
              platformName,
            },
          );
          followup.followUpSent[i] = true;
          sent++;
        } catch (e: any) {
          errors.push(`${followup.quoteNumber} day ${i + 1}: ${e?.message}`);
        }
      }

      // Persist updated sent flags
      await this.redisService.set(`rfq:followup:${followup.quoteNumber}`, followup, 60 * 60 * 24 * 7);
    }

    return { sent, errors };
  }

  async handleSlackEvent(body: any): Promise<void> {
    const event = body.event;

    if (!event) {
      this.logger.warn('[Slack] No event in payload');
      return;
    }
    if (event.bot_id || event.subtype) {
      this.logger.debug(
        `[Slack] Ignoring event — bot_id: ${event.bot_id}, subtype: ${event.subtype}`,
      );
      return;
    }
    if (event.type !== 'app_mention' && event.type !== 'message') {
      this.logger.debug(`[Slack] Ignoring unsupported event type: ${event.type}`);
      return;
    }

    const eventId: string = body.event_id;
    if (eventId) {
      const dedupKey = `slack:event:${eventId}`;
      const seen = await this.redisService.get(dedupKey);
      if (seen) {
        this.logger.log(`Duplicate Slack event ${eventId}, skipping`);
        return;
      }
      await this.redisService.set(dedupKey, '1', SLACK_EVENT_DEDUP_TTL);
    }

    const userText: string = (event.text ?? '')
      .replace(/<@[A-Z0-9]+>/g, '')
      .trim();

    if (!userText) {
      this.logger.debug('[Slack] Empty user text after stripping mentions, skipping');
      return;
    }

    const channel: string = event.channel;
    const threadTs: string = event.thread_ts ?? event.ts;
    const userId: string = event.user;

    this.logger.log(`[Slack] ${userId} in ${channel}: "${userText}"`);

    const historyKey = `slack:history:${channel}:${userId}`;
    const history: ChatMessage[] =
      (await this.redisService.get(historyKey)) ?? [];

    const aiMessages: ChatMessage[] = [
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    const aiResponse =
      await this.aiService.generateResponseWithHistory(aiMessages);

    if (!aiResponse?.trim()) {
      this.logger.warn('[Slack] AI returned an empty response, skipping send');
      return;
    }

    await this.redisService.set(
      historyKey,
      [...aiMessages, { role: 'assistant', content: aiResponse }],
      HISTORY_TTL_SECONDS,
    );

    await this.slackService.sendMessage(channel, aiResponse, threadTs);
    this.logger.log(`[Slack] Response sent to ${channel}`);
  }
}
