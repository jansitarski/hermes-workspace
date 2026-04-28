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
  if (model.startsWith('us.') || model.startsWith('global.')) {
    return 'bedrock'
  }
  if (model.startsWith('gpt-') || model.startsWith('o1-')) {
    return 'copilot'
  }
  if (model.includes('claude')) {
    return model.includes('bedrock') ? 'bedrock' : 'copilot'
  }
  if (model.includes('gemini')) {
    return 'copilot'
  }
  if (model.includes('nova')) {
    return 'bedrock'
  }
  if (model.includes('/')) {
    const prefix = model.split('/')[0]
    if (prefix === 'anthropic' || prefix === 'openai') {
      return 'copilot'
    }
  }
  return 'unknown'
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

          if (sessionKey && getGatewayCapabilities().sessions) {
            const sessionResult = await switchSessionModel(sessionKey, trimmedModel)
            if (sessionResult.ok) {
              return json({
                ok: true,
                model: trimmedModel,
                provider,
              })
            }
          }

          const configResult = await updateDefaultModel(trimmedModel, provider)
          if (configResult.ok) {
            return json({
              ok: true,
              model: trimmedModel,
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
