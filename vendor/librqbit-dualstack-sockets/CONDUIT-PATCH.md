# Conduit patch

Vendored from the crates.io release of librqbit-dualstack-sockets 0.7.0.
Upstream: https://github.com/ikatson/librqbit-dualstack-sockets
License: Apache-2.0, retained in LICENSE.

The only source change extends the macOS interface-index binding branch to
all Apple targets. The upstream fallback calls socket2::Socket::bind_device,
which is available on Linux and Android but does not compile on iOS.
Apple targets use socket2's bind_device_by_index_v4/v6 instead.

Remove this Cargo patch when an upstream release includes Apple mobile support.
