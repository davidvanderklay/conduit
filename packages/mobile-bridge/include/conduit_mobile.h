#ifndef CONDUIT_MOBILE_H
#define CONDUIT_MOBILE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CONDUIT_MOBILE_ABI_VERSION 1

typedef struct ConduitEngine ConduitEngine;

uint32_t conduit_mobile_abi_version(void);
ConduitEngine *conduit_engine_new(void);
char *conduit_engine_dispatch(ConduitEngine *engine, const char *action_json);
void conduit_string_free(char *value);
void conduit_engine_free(ConduitEngine *engine);

#ifdef __cplusplus
}
#endif

#endif
