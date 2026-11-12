export * from './types'

export const SUPPORTED_MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4.5',
]

export const SUPPORTED_IMAGE_MODELS = [
  'dall-e-3',
  'midjourney',
  'replicate',
]

export const ORCHESTRATION_STRATEGIES = [
  'sequential',
  'parallel',
  'hierarchical',
] as const
