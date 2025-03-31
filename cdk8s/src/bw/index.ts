import { cdk8s, kplus } from '@main';
import { defaults, config, modules } from '@main';

import { Construct } from 'constructs';

const vTrue = kplus.EnvValue.fromValue("true");
const vFalse = kplus.EnvValue.fromValue("false");

export class Bitwarden extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, 'ns', { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, 'bitwarden', defaults.deployment);
    const domain = config.domains.internal.selfhostingWildcard.replace('*', 'bw');

    const bw = deployment.addContainer({
      name: "bitwarden",
      image: "vaultwarden/server:latest",
      securityContext: {
        user: 1000,
        group: 1000,
      },
      envVariables: {
        TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
        SIGNUPS_ALLOWED: vFalse,
        EXTENDED_LOGGING: vTrue,
        WEBSOCKET_ENABLED: vFalse,
        DOMAIN: kplus.EnvValue.fromValue(`https://${domain}/`),
        ROCKET_PORT: kplus.EnvValue.fromValue("8080"),
      },
      portNumber: 8080
    });

    const pvc = modules.sc.createBoundPVCWithScope(this, 'bitwarden', '/opt/bitwarden');
    bw.mount('/data', kplus.Volume.fromPersistentVolumeClaim(this, 'vol', pvc));

    const svc = deployment.exposeViaService({ ports: [{ port: 80, targetPort: bw.portNumber }] });
    modules.istio.createVService(this, {
      type: 'wildcard',
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: 'bw',
      path: '/',
    }
    );
  }
}
