import * as cdk8s from "cdk8s";
import * as kplus from "cdk8s-plus-33";

export { cdk8s, kplus };

import { config } from "./config";
export { config };

const res = (cpuMillis: number, memMi: number) => ({
  cpu: { request: kplus.Cpu.millis(cpuMillis), limit: kplus.Cpu.millis(cpuMillis) },
  memory: { request: cdk8s.Size.mebibytes(memMi), limit: cdk8s.Size.mebibytes(memMi) },
});

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
