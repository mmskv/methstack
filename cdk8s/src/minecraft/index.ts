import { JsonPatch } from "cdk8s";
import { kplus } from "@main";
import { defaults, config, env, ServiceChart, Construct } from "@main";

const cfg = config.services.minecraft;

export class Minecraft extends ServiceChart {
  public exporterSvc!: kplus.Service;

  constructor(
    scope: Construct,
    ns: string,
    private socksProxy: { host: string; port: number },
  ) {
    super(scope, ns);

    this.createServer();
    this.createTelegramBot();
  }

  private createServer() {
    const deployment = this.deploy("minecraft");
    const mine = deployment.addContainer({
      name: "minecraft",
      image: "ghcr.io/mmskv/minecraft:1.21.11v3",
      resources: defaults.resources.large,
      securityContext: { user: 1000, group: 1000, readOnlyRootFilesystem: false },
      ports: [
        { number: 25565, hostPort: cfg.ports.server, protocol: kplus.Protocol.TCP },
        { number: 24454, hostPort: cfg.ports.voice, protocol: kplus.Protocol.UDP },
      ],
    });
    this.mountPVC(mine, "mine-world", "/opt/mine", "/data");
    this.mountTmp(mine);

    (deployment as any).apiObject.addJsonPatch(
      JsonPatch.add("/spec/template/spec/containers/0/stdin", true),
      JsonPatch.add("/spec/template/spec/containers/0/tty", true),
    );

    deployment.addContainer({
      name: "mc-monitor",
      image: "itzg/mc-monitor:0.16.1",
      args: ["export-for-prometheus", "-servers", "localhost"],
      portNumber: 8080,
      resources: defaults.resources.tiny,
      ...defaults.runAsUser,
    });

    this.exporterSvc = new kplus.Service(this, "mc-exporter-svc", {
      selector: deployment,
      ports: [{ port: 8080, targetPort: 8080, name: "metrics" }],
    });
  }

  private createTelegramBot() {
    const deploy = this.deploy("tgbot");
    deploy.addContainer({
      name: "tgbot",
      image: "ghcr.io/mmskv/minecraft:tgbot",
      resources: defaults.resources.tiny,
      envVariables: {
        BOT_TOKEN: env(cfg.telegramBotToken),
        GROUPS: env(cfg.telegramGroups),
        SOCKS_HOST: env(this.socksProxy.host),
        SOCKS_PORT: env(this.socksProxy.port.toString()),
        MC_METRICS_URL: env(`http://${this.exporterSvc.name}:${this.exporterSvc.port}/metrics`),
      },
      ...defaults.runAsNobody,
    });
  }
}
