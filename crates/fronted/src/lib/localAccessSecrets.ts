/**
 * Opaque marker used by the paired WebUI for credentials that remain inside
 * the native host. It is safe to send back to the host, but must never be
 * shown as a real credential or accepted as user-entered secret material.
 */
export const LOCAL_ACCESS_SECRET_SENTINEL = "__XGENT_LOCAL_ACCESS_SECRET__";

export function isLocalAccessSecretSentinel(value: unknown): value is string {
  return value === LOCAL_ACCESS_SECRET_SENTINEL;
}
