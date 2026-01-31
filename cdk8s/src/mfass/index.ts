import { cdk8s, kplus } from "@main";
import { defaults, modules, config } from "@main";

import { Construct } from "constructs";

export class MFAss extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, "mfass", {
      ...defaults.deployment,
      dockerRegistryAuth: new kplus.Secret(this, "regcred", defaults.dockerconfigjson),
    });

    const mfass = deployment.addContainer({
      name: "mfass",
      image: config.services.mfass.image,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      ...defaults.runAsUser,
      envVariables: config.services.mfass.envVars,
      resources: defaults.resources.tiny,
      portNumber: 8080,
    });
    modules.sc.mountEmptyDir(this, mfass, "/tmp");

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: mfass.portNumber }],
    });
    modules.istio.createVService(this, {
      type: "domain",
      serviceName: svc.name,
      domain: config.domains.external.selfhosting,
      path: config.services.mfass.path,
    });
  }
}
