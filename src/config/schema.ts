import { z } from 'zod';

export const httpUrlSchema = z
  .string()
  .min(1, '目标网址不能为空')
  .transform((value, context) => {
    try {
      return new URL(value);
    } catch {
      context.addIssue({ code: 'custom', message: '目标网址必须是合法 URL' });
      return z.NEVER;
    }
  })
  .refine((url) => url.protocol === 'http:' || url.protocol === 'https:', {
    message: '目标网址只支持 http:// 或 https://',
  })
  .transform((url) => url.toString().replace(/\/$/, ''));

export const evalPilotConfigSchema = z.object({
  version: z.literal(1),
  projectRoot: z.string().min(1),
  targetUrl: httpUrlSchema,
  outputDir: z.string().min(1),
  browser: z.literal('chromium'),
  createdAt: z.iso.datetime(),
});

