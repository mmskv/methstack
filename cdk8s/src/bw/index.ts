import { kplus } from "@main";
import { defaults, env, ServiceChart, Construct } from "@main";

export class Bitwarden extends ServiceChart {
  public svc!: kplus.Service;

  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    const deployment = this.deploy("bitwarden");
    const bw = deployment.addContainer({
      name: "bitwarden",
      image: "vaultwarden/server:latest",
      ...defaults.runAsUser,
      envVariables: {
        TZ: env("Europe/Moscow"),
        SIGNUPS_ALLOWED: env("false"),
        EXTENDED_LOGGING: env("true"),
        WEBSOCKET_ENABLED: env("false"),
        DOMAIN: env(`https://${this.internalSubdomain("bw")}/`),
        ROCKET_PORT: env("8080"),
      },
      resources: defaults.resources.tiny,
      portNumber: 8080,
    });

    this.mountPVC(bw, "bitwarden", "/opt/bitwarden", "/data");
    this.mountTmp(bw);

    this.svc = this.exposeInternal(deployment, { port: 80, targetPort: 8080 }, "bw");
  }
}
