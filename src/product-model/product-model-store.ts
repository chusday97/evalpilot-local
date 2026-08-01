import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProductModel } from '../../types.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { productModelSchema } from './schemas.js';

export function productModelPath(outputDir: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('Product Model version 必须是正整数。');
  return resolve(outputDir, 'product-model', `product-model.v${version}.json`);
}

export async function saveProductModel(outputDir: string, model: ProductModel): Promise<ProductModel> {
  return writeSchemaJsonAtomic(productModelPath(outputDir, model.version), model, productModelSchema);
}

export async function loadProductModel(outputDir: string, version: number): Promise<ProductModel> {
  return readSchemaJson(productModelPath(outputDir, version), productModelSchema);
}

export async function listProductModelVersions(outputDir: string): Promise<number[]> {
  const directory = resolve(outputDir, 'product-model');
  if (!await pathExists(directory)) return [];
  return (await readdir(directory))
    .map((name) => /^product-model\.v(\d+)\.json$/.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}
