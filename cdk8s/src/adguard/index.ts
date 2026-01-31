import { cdk8s, kplus } from "@main";
import { defaults, config, modules } from "@main";

import { Construct } from "constructs";

export class Adguard extends cdk8s.Chart {
  public svc!: kplus.Service;
  public dnsSvc!: kplus.Service;

  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", {
      metadata: {
        name: ns,
        labels: {
          "istio-injection": "enabled",
        },
      },
    });

    const deployment = new kplus.Deployment(this, "deployment", defaults.deployment);
    deployment.podMetadata.addAnnotation("traffic.sidecar.istio.io/excludeInboundPorts", "53,853");

    const adguard = deployment.addContainer({
      name: "adguard",
      image: "docker.io/adguard/adguardhome",
      ports: [
        { number: 53, hostPort: 53, protocol: kplus.Protocol.UDP },
        { number: 53, hostPort: 53, protocol: kplus.Protocol.TCP },
        { number: 853, hostPort: 853, protocol: kplus.Protocol.TCP, name: "dot" },
        { number: 3000, protocol: kplus.Protocol.TCP, name: "web-ui" },
      ],
      resources: defaults.resources.medium,
      ...defaults.runAsRoot, // needs root to bind to port 53
    });

    const work = modules.sc.createBoundPVCWithScope(this, "adguard-work", "/opt/adguard/work");
    const conf = modules.sc.createBoundPVCWithScope(this, "adguard-conf", "/opt/adguard/conf");

    adguard.mount(
      "/opt/adguardhome/work",
      kplus.Volume.fromPersistentVolumeClaim(this, "adguard-work", work),
    );
    adguard.mount(
      "/opt/adguardhome/conf",
      kplus.Volume.fromPersistentVolumeClaim(this, "adguard-conf", conf),
    );
    modules.sc.mountEmptyDir(this, adguard, "/tmp");

    this.dnsSvc = new kplus.Service(this, "dns-svc", {
      selector: deployment.toPodSelector(),
      type: kplus.ServiceType.CLUSTER_IP,
      clusterIP: "10.43.0.11", // Hardcoding to use in vpn config
      ports: [
        { port: 53, targetPort: 53, name: "dns-tcp", protocol: kplus.Protocol.TCP },
        { port: 53, targetPort: 53, name: "dns-udp", protocol: kplus.Protocol.UDP },
      ],
    });

    this.svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: 3000 }],
    });

    modules.istio.createVService(this, {
      type: "wildcard",
      serviceName: this.svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: "adguard",
      path: "/",
    });

    modules.istio.createVService(this, {
      type: "domain",
      serviceName: this.svc.name,
      domain: config.domains.external.adguard,
      path: "/",
    });

    new cdk8s.ApiObject(this, "auth-policy", {
      apiVersion: "security.istio.io/v1beta1",
      kind: "AuthorizationPolicy",
      metadata: {
        name: "adguard-access-control",
        namespace: ns,
      },
      spec: {
        selector: {
          matchLabels: deployment.matchLabels,
        },
        action: "ALLOW",
        rules: [
          {
            to: [
              {
                operation: {
                  hosts: [config.domains.external.adguard],
                  paths: ["/dns-query", "/dns-query*"],
                  methods: ["GET", "POST"],
                },
              },
              {
                operation: {
                  hosts: [config.domains.internal.selfhostingWildcard + ":8443"],
                },
              },
            ],
          },
        ],
      },
    });
  }
}
