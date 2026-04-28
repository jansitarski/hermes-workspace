import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getGatewayCapabilities,
} from '../../server/hermes-api'
import { BEARER_TOKEN, HERMES_API } from '../../server/gateway-capabilities'
import { saveConfig } from '../../server/hermes-dashboard-api'

type ModelSwitchRequest = {
  model: string
  sessionKey?: string
}

type ModelSwitchResponse = {
  ok: boolean
  model?: string
  provider?: string
  error?: string
}

function inferProvider(model: string): string {
  // Handle explicit provider prefix: "copilot:gpt-4o" or "bedrock:us.anthropic.claude"
  if (model.includes(':')) {
    const prefix = model.split(':')[0].toLowerCase()
    if (prefix === 'copilot' || prefix === 'openai' || prefix === 'anthropic') {
      return 'copilot'
    }
    if (prefix === 'bedrock' || prefix === 'aws') {
      return 'bedrock'
    }
  }
  
  // Bedrock region-prefixed models
  if (model.startsWith('us.') || model.startsWith('global.')) {
    return 'bedrock'
  }
  
  // OpenAI models
  if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-')) {
    return 'copilot'
  }
  
  // Claude models
  if (model.includes('claude')) {
    return model.includes('bedrock') || model.startsWith('us.') ? 'bedrock' : 'copilot'
  }
  
  // Other common models
  if (model.includes('gemini')) {
    return 'copilot'
  }
  if (model.includes('nova')) {
    return 'bedrock'
  }
  
  // Slash-separated format (e.g., "anthropic/claude", "openai/gpt-4")
  if (model.includes('/')) {
    const prefix = model.split('/')[0]
    if (prefix === 'anthropic' || prefix === 'openai') {
      return 'copilot'
    }
  }
  
  return 'unknown'
}

function stripProviderPrefix(model: string): string {
  if (model.includes(':')) {
    return model.split(':').slice(1).join(':')
  }
  return model
}

async function switchSessionModel(
  sessionKey: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (BEARER_TOKEN) {
      headers['Authorization'] = `Bearer ${BEARER_TOKEN}`
    }

    const response = await fetch(
      `${HERMES_API}/api/sessions/${sessionKey}/model`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model }),
      }
    )

    if (response.ok) {
      return { ok: true }
    }

    return {
      ok: false,
      error: `Session switch failed: ${response.status} ${response.statusText}`,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function updateDefaultModel(
  model: string,
  provider: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const configPatch = {
      model: {
        default: model,
        provider: provider,
      },
    }

    await saveConfig(configPatch)
    
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export const Route = createFileRoute('/api/model-switch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 }
          )
        }

        await ensureGatewayProbed()

        try {
          const body = (await request.json()) as ModelSwitchRequest
          const { model, sessionKey } = body

          if (!model || typeof model !== 'string' || model.trim().length === 0) {
            return json(
              { ok: false, error: 'Invalid model parameter' },
              { status: 400 }
            )
          }

          const trimmedModel = model.trim()
          const provider = inferProvider(trimmedModel)
          const cleanModel = stripProviderPrefix(trimmedModel)

          if (sessionKey && getGatewayCapabilities().sessions) {
            const sessionResult = await switchSessionModel(sessionKey, cleanModel)
            if (sessionResult.ok) {
              return json({
                ok: true,
                model: cleanModel,
                provider,
              })
            }
          }

          const configResult = await updateDefaultModel(cleanModel, provider)
          if (configResult.ok) {
            return json({
              ok: true,
              model: cleanModel,
              provider,
            })
          }

          return json(
            {
              ok: false,
              error: 'Model switch failed: Gateway did not accept the change',
            },
            { status: 503 }
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return json(
            { ok: false, error: `Model switch failed: ${message}` },
            { status: 500 }
          )
        }
      },
    },
  },
})
