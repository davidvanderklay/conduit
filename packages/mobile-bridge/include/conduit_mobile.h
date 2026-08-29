#ifndef CONDUIT_MOBILE_H
#define CONDUIT_MOBILE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CONDUIT_MOBILE_ABI_VERSION 2

typedef struct ConduitEngine ConduitEngine;

uint32_t conduit_mobile_abi_version(void);
/* The caller owns the returned handle. */
ConduitEngine *conduit_engine_new(void);
/* The returned UTF-8 JSON string must be released with conduit_string_free. */
char *conduit_engine_dispatch(ConduitEngine *engine, const char *action_json);
/* Runs a stateless conduit-core domain action. The caller owns the returned string. */
char *conduit_core_evaluate(const char *action_json);
void conduit_string_free(char *value);
/* All dispatch calls must finish before the handle is freed. */
void conduit_engine_free(ConduitEngine *engine);

#ifdef __cplusplus
}
#endif

#endif
