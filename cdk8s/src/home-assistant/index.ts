import { cdk8s, kplus } from '@main';
import { defaults, config, modules } from '@main';

import { Construct } from 'constructs';

export class HomeAssistant extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, 'ns', { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, 'deployment', defaults.deployment);

    const home = deployment.addContainer({
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:stable",
      envVariables: {
        TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
      },
      portNumber: 8123,
      securityContext: {
        privileged: true,
        allowPrivilegeEscalation: true,
        ...defaults.runAsRoot.securityContext,
      },
    });

    const conf = modules.sc.createBoundPVCWithScope(this, 'homeassistant-config', '/opt/homeassistant');
    home.mount('/config', kplus.Volume.fromPersistentVolumeClaim(this, 'config-vol', conf));

    home.mount('/dev/ttyACM0', kplus.Volume.fromHostPath(
      this, 'tty-acm0', 'tty-acm0', {
      path: '/dev/ttyACM0',
      type: kplus.HostPathVolumeType.CHAR_DEVICE,
    }));

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: home.portNumber }]
    });
    modules.istio.createVService(this, {
      type: 'wildcard',
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: 'home',
      path: '/',
    });
  }
}
