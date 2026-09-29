/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'
import type { ModelSelectionPolicy } from './model-selection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that this session's delegation tool exposes child provider,
     * model, and reasoning-effort selection. Appended before the first model
     * request; absence means the fixed-route definition. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Exact routes authorized for child LLM selection, or null when disabled. */
    subagentModelSelectionPolicy: AllowedModelRoute[] | null
  }
}

const modelSelectionPolicySchema: zod.ZodType<AllowedModelRoute[] | null> = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
}).strict()).min(1).nullable()

/** Host-only projection of the durable model-selection policy. */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the exact route list captured for a model-selectable definition.
 * @param projections - registry that owns the policy projection.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 */
export function subagentModelSelectionPolicy(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return projections.stateOf(session, 'subagentModelSelectionPolicy')?.map(route => ({ ...route }))
}

/**
 * Append the route policy once, before its definition can reach a model request.
 * @param projections - registry that owns the policy projection.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 */
export function recordSubagentModelSelection(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
  allowedModels: readonly AllowedModelRoute[],
): void {
  if (subagentModelSelectionPolicy(projections, session) !== undefined) return
  session.append('subagent/model-selection-policy', {
    allowedModels: allowedModels.map(route => ({ ...route })),
  })
}

/** Read-only projection registry source that owns the durable policy state. */
export type ModelSelectionProjectionSource = Pick<SessionProjectionRegistry, 'stateOf'>

/** Read-only Host settings source sampled for fresh top-level Sessions. */
export interface ModelSelectionSettingsSource {
  /** Read the current user preference for newly composed Sessions. */
  current(): { readonly enabled: boolean; readonly allowedModels: readonly AllowedModelRoute[] }
}

/** Read-only Session registry source used for child policy inheritance. */
export interface ModelSelectionSessionSource {
  /** Resolve one live Session by durable identity. */
  get(id: SessionId): Session | undefined
}

/**
 * Resolve one Session's model-selection policy: its durable recorded decision
 * when present, its parent's recorded decision for a subagent child, and the
 * sampled Host setting for a fresh top-level Session. A resolved policy is
 * recorded durably before it is returned, so the Session's delegation
 * capability stays reconstructable from its log.
 * @param projections - registry that owns the policy projection.
 * @param settings - Host settings owner sampled for fresh Sessions.
 * @param sessions - Session registry required when a child inherits its parent policy.
 * @param session - Session receiving the model-selectable delegation definition.
 * @param owner - plugin label for failure messages.
 * @returns the Session's route policy, or undefined when selection stays off.
 */
export function sampleSessionModelSelectionPolicy(
  projections: ModelSelectionProjectionSource,
  settings: ModelSelectionSettingsSource,
  sessions: ModelSelectionSessionSource | undefined,
  session: Session,
  owner: string,
): ModelSelectionPolicy | undefined {
  const freshSession = session.firstLiveSeq === 0
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    && session.eventAt(SessionSeq(0))?.type !== 'session/end-seed'
  let allowedModels: readonly AllowedModelRoute[] | undefined
    = subagentModelSelectionPolicy(projections, session)
  if (allowedModels === undefined) {
    const parentId = session.header.origin === 'subagent'
      ? session.header.parentSession
      : undefined
    if (parentId !== undefined) {
      if (sessions === undefined) {
        throw new Error(`${owner}: child model-selection inheritance requires the Session registry`)
      }
      const parent = sessions.get(parentId)
      allowedModels = parent === undefined
        ? undefined
        : subagentModelSelectionPolicy(projections, parent)
    } else if (freshSession) {
      const current = settings.current()
      allowedModels = current.enabled ? current.allowedModels : undefined
    }
  }
  if (allowedModels !== undefined) {
    recordSubagentModelSelection(projections, session, allowedModels)
  }
  return allowedModels === undefined ? undefined : { routes: allowedModels }
}
