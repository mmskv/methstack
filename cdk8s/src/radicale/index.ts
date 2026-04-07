import { kplus } from "@main";
import { defaults, config, ServiceChart, Construct } from "@main";

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

export class Radicale extends ServiceChart {
  public svc!: kplus.Service;

  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    const { username, password } = config.services.radicale;

    const deployment = this.deploy("radicale");
    const radicale = deployment.addContainer({
      name: "radicale",
      image: "ghcr.io/kozea/radicale:3.6.1",
      portNumber: 5232,
      resources: defaults.resources.tiny,
      ...defaults.runAsUser,
    });
    this.mountTmp(radicale);

    this.mountSecret(radicale, deployment, "config", "/etc/radicale", {
      config: radicaleConfig,
      users: `${username}:${password}\n`,
    });

    this.mountPVC(radicale, "radicale-data", "/opt/radicale", "/var/lib/radicale/collections");

    this.svc = this.exposeInternal(deployment, { port: 80, targetPort: 5232 }, "cal");
  }
}
