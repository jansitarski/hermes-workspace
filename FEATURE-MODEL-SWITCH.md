# Dynamic Model Switching Feature

This implementation adds runtime model switching capability to Hermes Workspace, allowing users to seamlessly switch between different AI models (Copilot, Bedrock, etc.) through the UI without restarting.

## What Was Added

### `/src/routes/api/model-switch.ts`
Server-side API endpoint that handles model switching requests from the UI.

**Features:**
- ✅ Session-level model switching (temporary, per-conversation)
- ✅ Config-level switching (persists to `~/.hermes/config.yaml`)
- ✅ Automatic provider inference from model ID
- ✅ Graceful fallback strategy
- ✅ Proper authentication and error handling

## How It Works

### 1. Client Request
The UI (via slash commands, mode selector, or settings) sends:
```typescript
POST /api/model-switch
{
  "model": "gpt-5.4",
  "sessionKey": "main" // optional
}
```

### 2. Provider Inference
The server automatically detects the provider:
- `us.*` or `global.*` → Bedrock
- `gpt-*`, `o1-*` → Copilot
- `claude*` (without bedrock) → Copilot
- `*bedrock*` → Bedrock
- `gemini*` → Copilot
- `nova*` → Bedrock

### 3. Switching Strategy
1. **Try session-level switch** (if `sessionKey` provided and gateway supports sessions)
   - Calls: `POST ${HERMES_API}/api/sessions/${sessionKey}/model`
   - Effect: Switches model for that conversation only
   
2. **Fallback to config update**
   - Updates `~/.hermes/config.yaml` via dashboard API
   - Effect: Changes default model (persists across restarts)

### 4. Response
```typescript
{
  "ok": true,
  "model": "gpt-5.4",
  "provider": "copilot"
}
```

## Configuration Requirements

### Setup Models Catalog
Create/edit `~/.hermes/models.json`:
```json
[
  {
    "model": "gpt-5.4",
    "provider": "copilot",
    "name": "GPT-5.4"
  },
  {
    "model": "us.anthropic.claude-sonnet-4-6",
    "provider": "bedrock",
    "name": "Claude Sonnet 4.6 (Bedrock)"
  }
]
```

### Configure Providers
Edit `~/.hermes/config.yaml`:
```yaml
model:
  provider: "copilot"
  default: "gpt-5.4"
  base_url: "https://api.githubcopilot.com"

bedrock:
  region: "us-east-2"
  discovery:
    enabled: true

providers:
  copilot:
    base_url: "https://api.githubcopilot.com"
  bedrock:
    region: "us-east-2"
```

## Usage Examples

### Via Slash Command
```
/model copilot:gpt-5.4
/model bedrock:us.anthropic.claude-sonnet-4-6
```

### Via API
```bash
curl -X POST http://localhost:3000/api/model-switch \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4"}'
```

### Via Mode Selector
1. Click "Mode" button in chat composer
2. Select a mode with preferred model
3. Confirm switch when prompted

## Testing

```bash
# Start services
hermes gateway run          # Terminal 1
hermes dashboard            # Terminal 2
cd ~/hermes-workspace
pnpm dev                    # Terminal 3

# Test endpoint
curl -X POST http://localhost:3000/api/model-switch \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4"}'

# Expected: {"ok":true,"model":"gpt-5.4","provider":"copilot"}
```

## Implementation Notes

### Why This Was Needed
- UI components (ModeSelector, slash commands, settings) already expected `/api/model-switch` endpoint
- Client code called this endpoint but it didn't exist (404 errors)
- This completes the feature by implementing the missing server-side handler

### Design Decisions
1. **Two-tier strategy**: Tries session-level first (temporary), falls back to config (persistent)
2. **Provider inference**: Automatic detection reduces user friction
3. **Error resilience**: Graceful fallbacks if gateway doesn't support session switching
4. **Auth required**: Only authenticated users can switch models (security)

### Future Enhancements
- [ ] Model validation against available catalog before switching
- [ ] Rate limiting to prevent abuse
- [ ] Webhook notifications on model switch
- [ ] Usage analytics per model/provider
- [ ] Model recommendation based on conversation context

## Architecture

```
┌─────────────────┐
│   UI Component  │  (ModeSelector, SlashCommand, Settings)
└────────┬────────┘
         │ POST /api/model-switch
         ▼
┌─────────────────┐
│   model-switch  │  (This file - Authentication, Provider Inference)
│   .ts Route     │
└────────┬────────┘
         │
         ├─► Try Session Switch (if sessionKey)
         │   POST ${HERMES_API}/api/sessions/{key}/model
         │
         └─► Fallback: Update Config (persists)
             PATCH ~/.hermes/config.yaml via dashboard API
```

## Contributing

This implementation follows existing Hermes Workspace patterns:
- Uses `isAuthenticated()` middleware
- Calls `ensureGatewayProbed()` before gateway operations
- Returns JSON responses with `{ ok: boolean, error?: string }` shape
- Uses `BEARER_TOKEN` for gateway authentication
- Integrates with dashboard API for config management

## Related Files
- `src/lib/gateway-api.ts` - Client-side API wrapper calling this endpoint
- `src/components/mode-selector.tsx` - UI component using model switching
- `src/routes/api/models.ts` - Model catalog endpoint
- `src/screens/settings/providers-screen.tsx` - Provider management UI
