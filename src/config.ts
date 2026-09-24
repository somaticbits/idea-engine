export type Dose = 'low' | 'medium' | 'high';
export const presets = {
  low: { temperature: 1, min_p: 0.1, coherence: 0.7, surprise: 0.3 },
  medium: { temperature: 1.4, min_p: 0.07, coherence: 0.45, surprise: 0.6 },
  high: { temperature: 1.8, min_p: 0.05, coherence: 0.2, surprise: 0.9 },
} as const;
export const CHAT_MODEL = 'deepseek/deepseek-v4.1-flash';
export const JEV_MODEL = 'jev-1.13';
export const MAX_REQUEST_BYTES = 8192;
