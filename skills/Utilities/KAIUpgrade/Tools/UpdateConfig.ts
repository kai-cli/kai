/**
 * UpdateConfig.ts — Settings schema introspection tool
 *
 * Provides the update-config workflow with schema-aware knowledge of
 * valid settings keys, types, and constraints.
 *
 * Usage (via skill workflow):
 *   const schema = getSettingsSchema();
 *   const keys = getTopLevelKeys();     // ['env', 'permissions', 'hooks', ...]
 *   const hookEvents = getHookEvents(); // ['PreToolUse', 'PostToolUse', ...]
 */

import { SETTINGS_SCHEMA } from '../../../../scripts/settings-schema';

type SchemaObj = Record<string, unknown>;

export function getSettingsSchema(): SchemaObj {
  return SETTINGS_SCHEMA as unknown as SchemaObj;
}

export function getTopLevelKeys(): string[] {
  const schema = SETTINGS_SCHEMA as unknown as SchemaObj;
  const props = (schema['properties'] as SchemaObj) ?? {};
  return Object.keys(props);
}

export function getHookEvents(): string[] {
  const schema = SETTINGS_SCHEMA as unknown as SchemaObj;
  const hooks = (schema['properties'] as SchemaObj)?.['hooks'] as SchemaObj | undefined;
  const propNames = hooks?.['propertyNames'] as SchemaObj | undefined;
  return (propNames?.['enum'] as string[]) ?? [];
}

export function getPermissionModes(): string[] {
  const schema = SETTINGS_SCHEMA as unknown as SchemaObj;
  const perms = (schema['properties'] as SchemaObj)?.['permissions'] as SchemaObj | undefined;
  const props = perms?.['properties'] as SchemaObj | undefined;
  const defaultMode = props?.['defaultMode'] as SchemaObj | undefined;
  return (defaultMode?.['enum'] as string[]) ?? [];
}

export function describeKey(key: string): string | null {
  const schema = SETTINGS_SCHEMA as unknown as SchemaObj;
  const props = (schema['properties'] as SchemaObj) ?? {};
  const keySchema = props[key] as SchemaObj | undefined;
  if (!keySchema) return null;
  return (keySchema['description'] as string) ?? `type: ${keySchema['type'] ?? 'unknown'}`;
}
