# Install

You have to copy cert-manager's certificate into
Adguard config as it doesn't do TLS termination as it
doesn't do TLS termination.

## Usage

My config is encrypted with [`git-crypt`](https://github.com/AGWA/git-crypt), here is an exampe

```ts
import { kplus } from '@main';

export const config = {
  domains: {
    internal: {
      selfhostingWildcard: '*.int.example.com',
    },
    external: {
      selfhosting: 'example.com',
      sidehustle: 'citadelsecurities.com',
    }
  },
  cloudflareApiToken: "secret",
  dockerconfig: { // useful if you have private images
    auths: {
      "ghcr.io": {
        auth: "mycreds",
      }
    }
  },
  extraCerts: [
    "extra.example.com",
  ],
  services: {
    mfass: {
      image: "ghcr.io/my/image:latest",
      path: "/mfass",
      envVars: {
        RUST_LOG: kplus.EnvValue.fromValue("info"),
        WEB_PASSWORD: kplus.EnvValue.fromValue("amongus"),
      }
    }
  }
}
```
