# `@seekite/engine-native-darwin-x64`

Prebuilt **x86_64-apple-darwin** (macOS on Intel) addon for
[`@seekite/engine-native`](https://www.npmjs.com/package/@seekite/engine-native).

This is an implementation package selected through the root package's optional
dependencies. Install `@seekite/engine-native`, not this package directly. If
no prebuild matches the host, Seekite can fall back to its WebAssembly provider
without compiling during installation.

The embedding implementation is derived from Ternlight v0.1.1 at commit
`c6d2baa06a258388443de8c32154789e2d564d66`, licensed under MIT. The complete
upstream notice is included as `TERNLIGHT-LICENSE`; Seekite's own MIT terms are
included as `LICENSE`.
