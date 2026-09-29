/** Model-facing discovery of LLM routes available to child Agents. */

import type { Context } from '@deepseek-ai/cordis'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { AllowedModelRoute, ModelSelectionPolicy } from './model-selection.ts'
import { subagentModelSelectionPolicy } from './model-selection-state.ts'

interface ListSubagentModelsRequest {
  readonly provider?: string
  readonly model?: string
}

/** Resolve one registered provider with a model-correctable diagnostic. */
function registeredProvider(
  llm: LlmRuntime,
  policy: ModelSelectionPolicy,
  providerId: string,
): LlmProviderInfo {
  const providers = llm.listProviders()
  const provider = providers.find(candidate => candidate.id === providerId)
  if (provider !== undefined) return provider
  const available = providers
    .filter(candidate => policy.routes.some(route => route.provider === candidate.id))
    .map(candidate => candidate.id)
    .join(', ') || '(none)'
  throw new Error(`LLM provider "${providerId}" is not registered; available providers: ${available}`)
}

/** Render one advertised or resolved model. */
function modelLine(provider: string, model: { id: string; name: string; description?: string }): string {
  return `${provider}/${model.id} — ${model.name}${model.description === undefined ? '' : `: ${model.description}`}`
}

/** Read the requested provider, allowed models, or exact-model efforts. */
async function listSubagentModels(
  ctx: Context,
  policyHandle: ProjectionHandle<AllowedModelRoute[] | null>,
  request: ListSubagentModelsRequest,
  exec: ToolRunContext,
): Promise<string> {
  if (exec.agent === undefined) throw new Error('list_subagent_models requires a calling agent')
  const routes = subagentModelSelectionPolicy(policyHandle, exec.agent.session)
  let policy = routes === undefined ? undefined : { routes }
  const selectionEnabled = policy !== undefined
  if (policy === undefined) {
    const { provider, model } = parentAgentOptionsForDelegation(exec.agent)
    if (provider === undefined || model === undefined) {
      throw new Error('cannot discover child LLM routes without a parent provider and model')
    }
    policy = { routes: [{ provider, model }] }
  }
  const { signal } = exec
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
  }
  if (request.model !== undefined && request.provider === undefined) {
    throw new Error('`model` requires `provider`')
  }
  if (request.provider === undefined) {
    const providers = llm.listProviders()
      .filter(provider => policy.routes.some(route => route.provider === provider.id))
    return providers.length === 0
      ? '(no LLM providers)'
      : providers.map(provider => `${provider.id} — ${provider.name}`).join('\n')
  }
  if (request.provider.length === 0) throw new Error('`provider` must be non-empty')
  const allowedRoutes = policy.routes.filter(route => route.provider === request.provider)
  const [firstRoute] = allowedRoutes
  if (firstRoute === undefined) {
    throw new Error(`LLM provider "${request.provider}" is not allowed for this Session`)
  }
  const provider = registeredProvider(llm, policy, request.provider)
  if (request.model === undefined) {
    const models = selectionEnabled
      ? (await llm.listModels(provider.id)).filter(model => allowedRoutes.some(route => route.model === model.id))
      : [await llm.resolveModelInfo(provider.id, firstRoute.model, signal)]
    signal.throwIfAborted()
    return models.length === 0
      ? `(no advertised models for ${provider.id})`
      : models.map(model => modelLine(provider.id, model)).join('\n')
  }
  if (request.model.length === 0) throw new Error('`model` must be non-empty')
  if (!allowedRoutes.some(route => route.model === request.model)) {
    throw new Error(`child LLM route "${provider.id}/${request.model}" is not allowed for this Session`)
  }
  const model = await llm.resolveModelInfo(provider.id, request.model, signal)
  const efforts = model.reasoning?.efforts.map(effort => (
    `${effort.id}${model.reasoning?.defaultEffort === effort.id ? ' (default)' : ''} — ${effort.name}`
    + (effort.description === undefined ? '' : `: ${effort.description}`)
  )).join('\n') || '(no advertised reasoning efforts)'
  return `${modelLine(provider.id, model)}\nReasoning efforts:\n${efforts}`
}

/**
 * Register discovery of the calling Session’s authorized child models.
 * @param ctx - Context carrying the tool registry and LLM service.
 * @param policyHandle - retained reader for the Session’s authorized child routes.
 * @returns the registration's disposer.
 */
export function registerListSubagentModels(
  ctx: Context,
  policyHandle: ProjectionHandle<AllowedModelRoute[] | null>,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'list_subagent_models',
    description:
      'Inspect subagent models without changing the current Agent. No arguments: providers; '
      + '`provider`: allowed models; `provider` + `model`: that model and its reasoning efforts. '
      + 'Inspect options here before selecting a child provider and model; use returned ids for delegation.',
    parameters: {
      provider: {
        type: 'string',
        description: 'Registered LLM provider id.',
      },
      model: {
        type: 'string',
        description: 'Exact model id; requires provider.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, result) => [{ type: 'text', text: result }],
    },
    execute(args, exec) {
      return listSubagentModels(ctx, policyHandle, args, exec)
    },
  }))
}

/** Shared per-scope discovery registrations still held by at least one delegation tool. */
const sharedDiscoveryTools = new WeakMap<ScopeKey, { count: number; dispose: () => void }>()

/**
 * Register `list_subagent_models` once per scope for every delegation tool
 * that offers route selection in that scope. Both the subagent tool and the
 * Agent Teams tool read the calling Session's authorized routes at execute
 * time, so one definition serves every selection surface; a composition that
 * mounts several must still present exactly one discovery definition. The
 * first caller's context owns the registration; every caller receives a
 * disposer that releases its claim, and the last release removes the
 * definition. An unscoped context falls back to a plain registration on
 * that context.
 * @param ctx - context owning the registration; prefer the consuming Agent's
 * own context so plugin fiber disposal cannot remove a definition another tool still needs.
 * @param scope - scope key shared by the co-mounted selection surfaces, or undefined without one.
 * @param policyHandle - retained reader for the Session’s authorized child routes.
 * @returns the caller's release disposer.
 */
export function ensureListSubagentModels(
  ctx: Context,
  scope: ScopeKey | undefined,
  policyHandle: ProjectionHandle<AllowedModelRoute[] | null>,
): () => void {
  if (scope === undefined) return registerListSubagentModels(ctx, policyHandle)
  let shared = sharedDiscoveryTools.get(scope)
  if (shared === undefined) {
    shared = { count: 0, dispose: registerListSubagentModels(ctx, policyHandle) }
    sharedDiscoveryTools.set(scope, shared)
  }
  shared.count += 1
  return () => {
    const current = sharedDiscoveryTools.get(scope)
    if (current === undefined) return
    current.count -= 1
    if (current.count === 0) {
      sharedDiscoveryTools.delete(scope)
      current.dispose()
    }
  }
}
