/** Local scheduling hint only; native task/plan/policy authority is rechecked. */
export const MOBILE_BRANCH_RECOVERY_EVENT = "xgent:mobile-branch-recovery";
export const MOBILE_BRANCH_REVOCATION_EVENT = "xgent:mobile-branch-revocation";
export function notifyMobileBranchRecovery(entryId: string) {
  window.dispatchEvent(new CustomEvent(MOBILE_BRANCH_RECOVERY_EVENT, { detail: entryId }));
}
export function notifyMobileBranchRevocation(entryId: string) {
  window.dispatchEvent(new CustomEvent(MOBILE_BRANCH_REVOCATION_EVENT, { detail: entryId }));
}
