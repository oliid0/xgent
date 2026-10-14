#include "XgentResultReceiverBridge.h"

// Keep allocator ownership on the Rust side of the static-library boundary.
extern void xgent_result_free_v1(char *value);
void xgent_release_result(char *value) { xgent_result_free_v1(value); }
