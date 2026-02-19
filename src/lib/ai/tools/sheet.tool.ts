import { tool } from 'ai';
import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../redis/redis.service';

export function createSheetUploadTool(
  config: ConfigService,
  redis: RedisService,
) {
  return tool({
    description:
      'Retrieve previously uploaded product data after the user provides the correct secret confirmation code. ' +
      'Call this tool ONLY when the user has provided a secret code for a pending product upload. ' +
      'The uploadKey comes from the product upload session context in the conversation.',
    inputSchema: z.object({
      uploadKey: z
        .string()
        .describe('The upload key from the product upload session'),
      secretCode: z
        .string()
        .describe(
          'The secret confirmation code the user just provided verbatim',
        ),
    }),
    execute: async ({ uploadKey, secretCode }) => {
      try {
        const expectedCode = config.get<string>('UPLOAD_SECRET_CODE');
        if (!expectedCode) {
          return {
            success: false,
            message: 'Upload secret code is not configured on the server.',
          };
        }

        if (
          secretCode.trim().toLowerCase() !==
          expectedCode.trim().toLowerCase()
        ) {
          return {
            success: false,
            message: 'Invalid secret code. Upload denied.',
          };
        }

        const data: any[][] | null = await redis.get(
          `product-upload:${uploadKey}`,
        );
        if (!data || !Array.isArray(data) || data.length === 0) {
          return {
            success: false,
            message:
              'Upload session expired or not found. Please upload the file again.',
          };
        }

        await redis.delete(`product-upload:${uploadKey}`);

        return {
          success: true,
          message: `Successfully retrieved ${data.length} rows (including header) from the uploaded file.`,
          data,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to retrieve data: ${err?.message ?? 'unknown error'}`,
        };
      }
    },
  });
}
