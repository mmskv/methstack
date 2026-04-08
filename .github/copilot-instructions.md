# Copilot Instructions — methstack

Kubernetes homelab infrastructure defined in TypeScript via **cdk8s** + **cdk8s-plus-33**.
Single-node k3s cluster. All manifests are generated with `npm run synth` from `cdk8s/`.

## Project layout

```
cdk8s/
  main.ts          — entry point, shared base class (ServiceChart), defaults, app wiring
  config.ts        — all secrets, credentials, domains, service config
  src/istio.ts     — Istio gateways, VirtualServices, cert-manager certificates
  src/sc.ts        — local StorageClass, PV/PVC creation
  src/util.ts      — handlebars templating for .hbs files
  src/<svc>/       — one directory per service (bw, gonic, immich, etc.)
  src/private/     — services using private container registry (vpn, pvpn, firefly, monitoring)
  imports/         — auto-generated CRD types (do not edit)
```

## Path aliases (tsconfig)

- `@main` → `main.ts`
- `@istio` → `src/istio.ts`
- `@crds/*` → `imports/*`

Always import shared utilities from `@main`:

```ts
import { kplus } from "@main";
import { defaults, config, env, ServiceChart, Construct } from "@main";
```

## ServiceChart pattern

Every service extends `ServiceChart`. It provides:

- `deploy(name, props?)` — creates a Deployment (includes regcred by default)
- `mountPVC(container, name, hostPath, mountPath, opts?)` — local-path PVC
- `mountEmptyDir(container, path)` / `mountTmp(container)` — tmpfs emptyDirs
- `mountConfig(container, deployment, id, mountPath, data, items?)` — ConfigMap with auto hash annotation
- `mountSecret(container, deployment, id, mountPath, data, items?, defaultMode?)` — Secret with auto hash annotation
- `exposeInternal(deployment, ports, subdomain)` — Service + internal VirtualService
- `internalSubdomain(sub)` — resolves `*.int.niggalink.space`
- `postgres(id, opts)` — full postgres deployment (explicit `pvcName` required)

### Method A — multi-unit services

If a service has ≥2 deployments, use private methods called from the constructor:

```ts
export class MyService extends ServiceChart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns);
    this.createDatabase();
    this.createApp();
  }
  private createDatabase() { /* ... */ }
  private createApp() { /* ... */ }
}
```

Single-deployment services use a flat constructor (no private methods).

### Shared deployment field

When multiple private methods operate on the same deployment, store it as `private gw!: kplus.Deployment` (or similar) and assign in the constructor.

## Constants & config

- Module-level `const` for image props, security contexts, probes — **not** class fields.
- `defaults.runAsRoot`, `defaults.runAsUser`, `defaults.runAsNobody` — use these, don't redefine.
- `defaults.resources.tiny | medium | large` — always set resources.
- Service-specific secrets/config live in `config.ts`, not inline.
- VPN-specific config lives in `src/private/vpn/config.ts` / `src/private/pvpn/config.ts`.

## Naming conventions

- EmptyDir names: `${container.name}-${pathName}-emptydir` (handled by `mountEmptyDir`).
- PVC names must be stable across refactors — pass explicit names to `mountPVC` / `postgres({ pvcName })`.
- Deployment names are the cdk8s construct ID — they appear in K8s resource names.

## Commands

```sh
cd cdk8s
npm run synth              # generate manifests to dist/
npx tsc --noEmit           # type-check only
```

## Validation checklist

After any change:

1. `npx tsc --noEmit` — must compile clean (ignore `pvpn/volumes.ts` if present)
2. `npm run synth` — must produce all expected manifests in `dist/`
3. Diff `dist/` against previous output to catch unintended behavioral changes
4. PVC names must not change (data loss risk)

## Style

- TypeScript strict mode. No `any` except the `deploy()` props parameter.
- No `public` keyword (it's the default).
- No commented-out dead code in new changes.
- `env("value")` helper for `EnvValue.fromValue`.
- Mount helpers over manual `Volume.from*` + `container.mount` when possible.
