import { kplus } from "@main";
import { defaults, env, ServiceChart, Construct } from "@main";

export class HomeAssistant extends ServiceChart {
  public svc!: kplus.Service;

  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    const deployment = this.deploy("deployment");
    const home = deployment.addContainer({
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:stable",
      envVariables: { TZ: env("Europe/Moscow") },
      portNumber: 8123,
      resources: defaults.resources.medium,
      securityContext: {
        privileged: true,
        allowPrivilegeEscalation: true,
        ...defaults.runAsRoot.securityContext,
      },
    });

    this.mountPVC(home, "homeassistant-config", "/opt/homeassistant", "/config");
    home.mount(
      "/dev/ttyACM0",
      kplus.Volume.fromHostPath(this, "tty-acm0", "tty-acm0", {
        path: "/dev/ttyACM0",
        type: kplus.HostPathVolumeType.CHAR_DEVICE,
      }),
    );

    this.svc = this.exposeInternal(deployment, { port: 80, targetPort: 8123 }, "home");
  }
}
