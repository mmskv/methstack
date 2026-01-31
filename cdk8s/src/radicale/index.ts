import { cdk8s, kplus } from "@main";
import { defaults, config, modules } from "@main";

import { Construct } from "constructs";

const radicaleConfig = `
[server]
hosts = 0.0.0.0:5232

[auth]
type = htpasswd
htpasswd_filename = /etc/radicale/users
htpasswd_encryption = plain

[storage]
filesystem_folder = /var/lib/radicale/collections

[rights]
type = owner_only
`.trim();

export class Radicale extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    const { username, password } = config.services.radicale;
    const usersFile = `${username}:${password}\n`;

    const configMap = new kplus.ConfigMap(this, "config", {
      data: {
        config: radicaleConfig,
        users: usersFile,
      },
    });

    const deployment = new kplus.Deployment(this, "radicale", defaults.deployment);
    const radicale = deployment.addContainer({
      name: "radicale",
      image: "ghcr.io/kozea/radicale:3.6.1",
      portNumber: 5232,
      resources: defaults.resources.tiny,
      ...defaults.runAsUser,
    });
    modules.sc.mountEmptyDir(this, radicale, "/tmp");

    const configVol = kplus.Volume.fromConfigMap(this, "config-vol", configMap, {
      items: { config: { path: "config" }, users: { path: "users" } },
    });
    radicale.mount("/etc/radicale", configVol, { readOnly: true });

    const data = modules.sc.createBoundPVCWithScope(this, "radicale-data", "/opt/radicale");
    radicale.mount(
      "/var/lib/radicale/collections",
      kplus.Volume.fromPersistentVolumeClaim(this, "data-vol", data),
    );

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: radicale.portNumber }],
    });
    modules.istio.createVService(this, {
      type: "wildcard",
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: "cal",
      path: "/",
    });
  }
}
