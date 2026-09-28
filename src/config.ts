export type Dose = 'low' | 'medium' | 'high';
export type ModelSettings = { dreamer: string; jev: string; narrator: string };
export const DEFAULT_MODELS: ModelSettings = {
  dreamer: 'deepseek/deepseek-v4.1-flash',
  jev: 'jev-1.13',
  narrator: 'deepseek/deepseek-v4.1-flash',
};
export const presets = {
  low: { temperature: 1, min_p: 0.1, coherence: 0.7, surprise: 0.3 },
  medium: { temperature: 1.4, min_p: 0.07, coherence: 0.45, surprise: 0.6 },
  high: { temperature: 1.8, min_p: 0.05, coherence: 0.2, surprise: 0.9 },
} as const;
export const MAX_REQUEST_BYTES = 8192;
