#!/usr/bin/env bash
# Sourced by native build scripts. Unset means the engine is absent.
case "${CONDUIT_P2P:-0}" in
  0) conduit_p2p_mode=direct; conduit_p2p_features=() ;;
  1) conduit_p2p_mode=p2p; conduit_p2p_features=(--features p2p) ;;
  *) echo 'CONDUIT_P2P must be 0 or 1' >&2; exit 1 ;;
esac
case "${CONDUIT_STORE_BUILD:-0}" in
  0) ;;
  1) [[ "$conduit_p2p_mode" == direct ]] || { echo 'Store builds must exclude P2P' >&2; exit 1; } ;;
  *) echo 'CONDUIT_STORE_BUILD must be 0 or 1' >&2; exit 1 ;;
esac
