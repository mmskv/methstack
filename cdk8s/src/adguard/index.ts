import { cdk8s, kplus } from '@main';
import { defaults, config, modules } from '@main';

import { Construct } from 'constructs';

const resourceSpec = {
  cpu: {
    request: kplus.Cpu.units(4),
    limit: kplus.Cpu.units(4),
  },
  memory: {
    request: cdk8s.Size.gibibytes(4),
    limit: cdk8s.Size.gibibytes(4),
  }
};

export class Adguard extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, 'ns', { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, 'deployment', defaults.deployment);
    const adguard = deployment.addContainer({
      name: "adguard",
      image: "docker.io/adguard/adguardhome",
      ports: [
        { number: 53, protocol: kplus.Protocol.UDP },
        { number: 53, hostPort: 53, protocol: kplus.Protocol.TCP },
        { number: 853, hostPort: 853, protocol: kplus.Protocol.TCP, name: "dot" },
        { number: 3000, protocol: kplus.Protocol.TCP, name: "web-ui" },
      ],
      resources: resourceSpec,
      ...defaults.runAsRoot // needs to bind to 53
    });

    const work = modules.sc.createBoundPVCWithScope(this, 'adguard-work', '/opt/adguard/work');
    const conf = modules.sc.createBoundPVCWithScope(this, 'adguard-conf', '/opt/adguard/conf');

    adguard.mount('/opt/adguardhome/work', kplus.Volume.fromPersistentVolumeClaim(this, 'adguard-work', work));
    adguard.mount('/opt/adguardhome/conf', kplus.Volume.fromPersistentVolumeClaim(this, 'adguard-conf', conf));

    new kplus.Service(this, 'dns-svc', {
      selector: deployment.toPodSelector(),
      type: kplus.ServiceType.CLUSTER_IP,
      clusterIP: '10.43.0.11', // Hardcoding to use in vpn config
      ports: [
        { port: 53, targetPort: 53, name: "dns-tcp", protocol: kplus.Protocol.TCP },
        { port: 53, targetPort: 53, name: "dns-udp", protocol: kplus.Protocol.UDP }
      ]
    });

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: 3000 }]
    });

    modules.istio.createVService(this, {
      type: 'wildcard',
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: 'adguard',
      path: "/",
    });
  }
}
