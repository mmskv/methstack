import { JsonPatch } from "cdk8s";
import { cdk8s, kplus } from "@main";
import { defaults, modules, config } from "@main";

import { Construct } from "constructs";

const cfg = config.services.minecraft;

export class Minecraft extends cdk8s.Chart {
  public exporterSvc!: kplus.Service;

  constructor(
    scope: Construct,
    ns: string,
    private socksProxy: { host: string; port: number },
  ) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, "minecraft", {
      ...defaults.deployment,
      dockerRegistryAuth: new kplus.Secret(this, "regcred", defaults.dockerconfigjson),
    });
    const mine = deployment.addContainer({
      name: "minecraft",
      image: "ghcr.io/mmskv/minecraft:1.21.11v3",
      resources: defaults.resources.large,
      securityContext: {
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: false,
      },
      ports: [
        { number: 25565, hostPort: cfg.ports.server, protocol: kplus.Protocol.TCP },
        { number: 24454, hostPort: cfg.ports.voice, protocol: kplus.Protocol.UDP },
      ],
    });
    const data = modules.sc.createBoundPVCWithScope(this, "mine-world", "/opt/mine");
    mine.mount("/data", kplus.Volume.fromPersistentVolumeClaim(this, "mine-data-vol", data));
    modules.sc.mountEmptyDir(this, mine, "/tmp");

    // Enable stdin + tty so tmux can run inside the container
    (deployment as any).apiObject.addJsonPatch(
      JsonPatch.add("/spec/template/spec/containers/0/stdin", true),
      JsonPatch.add("/spec/template/spec/containers/0/tty", true),
    );

    // mc-monitor sidecar for prometheus metrics
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

    this.createTelegramBot(this.exporterSvc);
  }

  private createTelegramBot(exporterSvc: kplus.Service) {
    const deploy = new kplus.Deployment(this, "tgbot", {
      ...defaults.deployment,
      dockerRegistryAuth: new kplus.Secret(this, "tgbot-regcred", defaults.dockerconfigjson),
    });

    deploy.addContainer({
      name: "tgbot",
      image: "ghcr.io/mmskv/minecraft:tgbot",
      resources: defaults.resources.tiny,
      envVariables: {
        BOT_TOKEN: kplus.EnvValue.fromValue(cfg.telegramBotToken),
        GROUPS: kplus.EnvValue.fromValue(cfg.telegramGroups),
        SOCKS_HOST: kplus.EnvValue.fromValue(this.socksProxy.host),
        SOCKS_PORT: kplus.EnvValue.fromValue(this.socksProxy.port.toString()),
        MC_METRICS_URL: kplus.EnvValue.fromValue(
          `http://${exporterSvc.name}:${exporterSvc.port}/metrics`,
        ),
      },
      ...defaults.runAsNobody,
    });
  }
}
