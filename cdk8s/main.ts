import * as cdk8s from "cdk8s";
import * as kplus from "cdk8s-plus-33";
import { Construct } from "constructs";

export { cdk8s, kplus, Construct };

import { config } from "./config";
export { config };

const res = (cpuMillis: number, memMi: number) => ({
  cpu: { request: kplus.Cpu.millis(cpuMillis), limit: kplus.Cpu.millis(cpuMillis) },
  memory: { request: cdk8s.Size.mebibytes(memMi), limit: cdk8s.Size.mebibytes(memMi) },
});

export const env = (v: string) => kplus.EnvValue.fromValue(v);

export const defaults = {
  resources: {
    tiny: res(100, 128),
    medium: res(1000, 2048),
    large: res(8000, 16384),
  },

  dockerconfigjson: {
    stringData: {
      ".dockerconfigjson": JSON.stringify(config.dockerconfig),
    },
    type: "kubernetes.io/dockerconfigjson",
  },

  deployment: {
    replicas: 1,
    strategy: kplus.DeploymentStrategy.recreate(),
    restartPolicy: kplus.RestartPolicy.ALWAYS,
  },

  runAsRoot: {
    securityContext: {
      ensureNonRoot: false,
      readOnlyRootFilesystem: false,
    },
  },

  runAsUser: {
    securityContext: {
      user: 1000,
      group: 1000,
      readOnlyRootFilesystem: true,
    },
  },

  runAsNobody: {
    securityContext: {
      user: 65534,
      group: 65534,
      readOnlyRootFilesystem: true,
    },
  },
};

import { LocalSC } from "./src/sc";
import { Istio } from "./src/istio";

const app = new cdk8s.App();
export const modules = {
  sc: new LocalSC(app, "sc"),
  istio: new Istio(app, "istio"),
};

export class ServiceChart extends cdk8s.Chart {
  constructor(scope: Construct, ns: string, opts?: { labels?: Record<string, string> }) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", {
      metadata: { name: ns, labels: opts?.labels },
    });
  }

  deploy(name: string, props: any = {}): kplus.Deployment {
    return new kplus.Deployment(this, name, {
      dockerRegistryAuth: new kplus.Secret(this, `${name}-regcred`, defaults.dockerconfigjson),
      ...defaults.deployment,
      ...props,
    });
  }

  mountPVC(
    container: kplus.Container,
    name: string,
    hostPath: string,
    mountPath: string,
    opts?: { readOnly?: boolean },
  ): void {
    const pvc = modules.sc.createBoundPVCWithScope(this, name, hostPath);
    container.mount(
      mountPath,
      kplus.Volume.fromPersistentVolumeClaim(this, `${name}-vol`, pvc, opts),
    );
  }

  mountEmptyDir(container: kplus.Container, path: string): void {
    const pathName = path.slice(1).replace(/\//g, "-").replace(/\./g, "dot");
    const name = `${container.name}-${pathName}-emptydir`;
    container.mount(
      path,
      kplus.Volume.fromEmptyDir(this, name, name, { medium: kplus.EmptyDirMedium.MEMORY }),
    );
  }

  mountTmp(container: kplus.Container): void {
    this.mountEmptyDir(container, "/tmp");
  }

  internalSubdomain(sub: string): string {
    return config.domains.internal.selfhostingWildcard.replace("*", sub);
  }

  exposeInternal(
    deployment: kplus.Deployment,
    ports: { port: number; targetPort?: number },
    subdomain: string,
  ): kplus.Service {
    const svc = deployment.exposeViaService({
      ports: [{ port: ports.port, targetPort: ports.targetPort ?? ports.port }],
    });
    modules.istio.createVService(this, {
      type: "wildcard",
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain,
      path: "/",
    });
    return svc;
  }

  postgres(
    id: string,
    opts: {
      image: string;
      creds: Record<string, kplus.EnvValue>;
      dataPath: string;
      pvcName: string;
      extraEnv?: Record<string, kplus.EnvValue>;
      extraMounts?: (container: kplus.Container) => void;
    },
  ): { svc: kplus.Service; deployment: kplus.Deployment } {
    const deployment = this.deploy(id);
    const pg = deployment.addContainer({
      name: "postgres",
      image: opts.image,
      envVariables: { ...opts.creds, ...opts.extraEnv },
      securityContext: { user: 999, group: 999 },
      resources: defaults.resources.medium,
      portNumber: 5432,
    });
    this.mountPVC(pg, opts.pvcName, opts.dataPath, "/var/lib/postgresql/data");
    this.mountEmptyDir(pg, "/var/run/postgresql");
    opts.extraMounts?.(pg);
    const svc = deployment.exposeViaService({ ports: [{ port: 5432 }] });
    return { svc, deployment };
  }
}

// Deployments depend on sc and istio
// so they are imported after them

import { Bitwarden } from "./src/bw";
import { Immich } from "./src/immich";
import { Adguard } from "./src/adguard";
import { HomeAssistant } from "./src/home-assistant";
import { MFAss } from "./src/mfass";
import { Gonic } from "./src/gonic";
import { Radicale } from "./src/radicale";
import { Minecraft } from "./src/minecraft";
import { VpnGateway } from "./src/private/vpn";
import { Firefly } from "./src/private/firefly";
import { Monitoring } from "./src/private/monitoring";

const vpn = new VpnGateway(app, "vpn");

const bw = new Bitwarden(app, "bw");
const immich = new Immich(app, "immich");
const adguard = new Adguard(app, "adguard");
const ha = new HomeAssistant(app, "home-assistant");
const gonic = new Gonic(app, "gonic");
const mc = new Minecraft(app, "minecraft", {
  host: `${vpn.socksProxySvc.name}.${vpn.namespace}`,
  port: vpn.socksProxySvc.port,
});

new MFAss(app, "mfass");
new Radicale(app, "radicale");
new Firefly(app, "firefly");

// Monitoring scrapes all other services, must be created last
const ref = (chart: cdk8s.Chart, svc: kplus.Service) => ({
  name: svc.name,
  port: svc.port,
  namespace: chart.namespace!,
});
new Monitoring(app, "monitoring", {
  httpProbes: [
    ref(bw, bw.svc),
    ref(immich, immich.svc.server),
    ref(ha, ha.svc),
    ref(gonic, gonic.svc),
    ref(adguard, adguard.svc),
  ],
  minecraft: ref(mc, mc.exporterSvc),
  wireguard: ref(vpn, vpn.wgExporterSvc),
  adguardDns: ref(adguard, adguard.dnsSvc),
});

app.synth();
