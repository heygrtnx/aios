import { tool } from 'ai';
import { z } from 'zod';
import type { RedisService } from '../../redis/redis.service';

export function createGetProductCatalogTool(redis: RedisService) {
  return tool({
    description:
      'Retrieve the current product catalog. Call this when the user asks about available products, ' +
      'what products are in stock, product names, prices, or SKUs. ' +
      'Returns the full catalog with SKU, name, price, and unit for each product.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const catalog: Record<
          string,
          { name: string; price: number | null; unit: string }
        > | null = await redis.get('product-catalog');

        if (!catalog || Object.keys(catalog).length === 0) {
          return {
            success: false,
            message: 'No product catalog found. A product file has not been uploaded yet.',
          };
        }

        const products = Object.entries(catalog).map(([sku, entry]) => ({
          sku,
          name: entry.name,
          price: entry.price,
          unit: entry.unit,
        }));

        return {
          success: true,
          count: products.length,
          products,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to retrieve product catalog: ${err?.message ?? 'unknown error'}`,
        };
      }
    },
  });
}
