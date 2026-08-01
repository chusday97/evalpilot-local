import type { ZodType } from 'zod';
import { readJsonFile, writeJsonAtomic } from './file-system.js';

export async function readSchemaJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  const value = await readJsonFile<unknown>(path);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${path} 不符合数据契约：${parsed.error.message}`);
  }
  return parsed.data;
}

export async function writeSchemaJsonAtomic<T>(path: string, value: T, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${path} 不符合数据契约：${parsed.error.message}`);
  }
  await writeJsonAtomic(path, parsed.data);
  return parsed.data;
}
