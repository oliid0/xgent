#ifndef XGENT_RESULT_RECEIVER_BRIDGE_H
#define XGENT_RESULT_RECEIVER_BRIDGE_H
#include <stdint.h>

// Inputs are live NUL-terminated UTF-8 strings for the duration of the call.
// JSON replies are owned Rust allocations; release each exactly once.
char *xgent_result_targets_v1(const char *path, const char *root, const char *host, const char *targets);
int32_t xgent_result_sync_v1(const char *path, const char *root, const char *host, const char *targets,
                           int32_t (*cancelled)(void *context), void *context);
char *xgent_result_pending_v1(const char *path, const char *root, const char *host);
int32_t xgent_result_notice_v1(const char *path, const char *root, const char *host,
                             const char *entry, int32_t accepted);
void xgent_release_result(char *value);
// Separate event-send authority; original native rule/installation must match.
int32_t xgent_event_scope_v1(const char *path, const char *root, const char *host, int32_t enabled);
char *xgent_event_sync_v1(const char *path, const char *root, const char *host, const char *events,
                        int32_t (*cancelled)(void *context), void *context);
int32_t xgent_event_results_ack_v1(const char *path, const char *root, const char *host, const char *targets);
char *xgent_event_health_scopes_v1(const char *path, const char *root, const char *host, const char *events);
#endif
