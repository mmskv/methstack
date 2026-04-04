import { kplus } from "@main";
import { defaults, modules, config, ServiceChart, Construct } from "@main";

export class MFAss extends ServiceChart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    const deployment = this.deploy("mfass");
    const mfass = deployment.addContainer({
      name: "mfass",
      image: config.services.mfass.image,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      ...defaults.runAsUser,
      envVariables: config.services.mfass.envVars,
      resources: defaults.resources.tiny,
      portNumber: 8080,
    });
    this.mountTmp(mfass);

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: 8080 }],
    });
    modules.istio.createVService(this, {
      type: "domain",
      serviceName: svc.name,
      domain: config.domains.external.selfhosting,
      path: config.services.mfass.path,
    });
  }
}
