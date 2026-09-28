import { z } from 'zod';

export const clean = (value: string) => value.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f<>]/g, '').trim();
export const seedSchema = z.string().max(120).transform(clean).pipe(z.string().min(1).max(60));
export const kitSchema = z.array(z.string().max(80).transform(clean).pipe(z.string().min(1).max(40))).max(30);
export const doseSchema = z.enum(['low', 'medium', 'high']);
const modelIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'Use a model ID without spaces.');
export const modelSettingsSchema = z.object({
  dreamer: modelIdSchema,
  jev: modelIdSchema,
  narrator: modelIdSchema,
}).strict();
export const tripSchema = z.object({ seed: seedSchema, dose: doseSchema, kit: kitSchema.optional() }).strict();
export const expandSchema = z.object({ dose: doseSchema }).strict();
export const cardSchema = z.object({
  pitch: z.string().min(1).max(600), chain: z.array(z.string().max(80)).min(1).max(50),
  stack: z.string().min(1).max(500), prototype: z.string().min(1).max(500),
  wildcard: z.string().min(1).max(300),
}).strict();
export type CardContent = z.infer<typeof cardSchema>;
