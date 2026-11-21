/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { AI_CHATS_SCHEMA, AI_MESSAGES_SCHEMA } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  // Chat history for the in-app coding agent. `worker.ts` only registers the
  // /api/ai/* routes when AI_CHATS_SCHEMA is present here, so removing these
  // two also removes the agent surface.
  AI_CHATS_SCHEMA,
  AI_MESSAGES_SCHEMA,
]
