export interface AgentRole {
  title: string
  description: string
  expertise: string[]
  behaviors: string[]
}

export interface Agent {
  id: string
  name: string
  role: AgentRole
  systemPrompt: string
  temperature: number
  maxTokens: number
  model: 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4.5'
  integrations: Integration[]
  createdAt: Date
  updatedAt: Date
}

export interface Integration {
  type: 'image-generation' | 'web-search' | 'database' | 'api' | 'custom'
  config: Record<string, unknown>
}

export interface Squad {
  id: string
  name: string
  description: string
  agents: Agent[]
  orchestrationStrategy: 'sequential' | 'parallel' | 'hierarchical'
  isPublic: boolean
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

export interface SquadExecution {
  id: string
  squadId: string
  startedAt: Date
  status: 'running' | 'completed' | 'failed'
  agents: AgentExecution[]
}

export interface AgentExecution {
  agentId: string
  agentName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input: string
  output: string
  error?: string
  duration: number
  timestamp: Date
}

export interface ImageGenerationTask {
  id: string
  prompt: string
  agentId: string
  model: 'dall-e-3' | 'midjourney' | 'replicate'
  status: 'queued' | 'generating' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
  createdAt: Date
}
