import { cdk8s, kplus } from "@main";
import { defaults, config, modules } from "@main";

import { Construct } from "constructs";
import * as yaml from "js-yaml";

const extraResourcesSpec = {
  cpu: {
    request: kplus.Cpu.units(2),
    limit: kplus.Cpu.units(4),
  },
  memory: {
    request: cdk8s.Size.gibibytes(6),
    limit: cdk8s.Size.gibibytes(6),
  },
};

const turnserverConfig = `
listening-port=3478
min-port=49152
max-port=65535
lt-cred-mech
use-auth-secret
static-auth-secret=${config.services.matrix.homeserverConfigPartial.turn_shared_secret}
realm=${config.services.matrix.homeserverConfigPartial.server_name}
external-ip=192.168.88.88
no-multicast-peers
no-loopback-peers
log-file=stdout
`.trim();

export class Matrix extends cdk8s.Chart {
  svc: Record<string, kplus.Service> = {};

  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    {
      const deployment = new kplus.Deployment(this, "db", {
        ...defaults.deployment,
      });
      const postgres = deployment.addContainer({
        name: "postgres",
        image: "docker.io/postgres:15-alpine",
        envVariables: {
          TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
          POSTGRES_INITDB_ARGS: kplus.EnvValue.fromValue(
            "--encoding=UTF-8 --lc-collate=C --lc-ctype=C",
          ),
          ...config.services.matrix.db.envCredVars,
        },
        securityContext: {
          user: 999,
          group: 999,
          readOnlyRootFilesystem: false,
        },
        portNumber: 5432,
      });
      const pgData = modules.sc.createBoundPVCWithScope(this, "matrix-pg", "/opt/matrix/postgres");
      postgres.mount(
        "/var/lib/postgresql/data",
        kplus.Volume.fromPersistentVolumeClaim(this, "postgres-vol", pgData),
      );
      modules.sc.mountEmptyDir(this, postgres, "/var/run/postgresql");
      this.svc.db = deployment.exposeViaService({ ports: [{ port: postgres.portNumber! }] });
    }

    {
      const coturnConfigMap = new kplus.ConfigMap(this, "coturn-config");
      coturnConfigMap.addData("turnserver.conf", turnserverConfig);

      const coturnDeployment = new kplus.Deployment(this, "coturn", {
        ...defaults.deployment,
        hostNetwork: true,
      });

      const coturnContainer = coturnDeployment.addContainer({
        name: "coturn",
        image: "coturn/coturn",
        args: ["-c", "/etc/coturn/turnserver.conf"],
        ...defaults.runAsUser,
      });

      coturnContainer.mount(
        "/etc/coturn/turnserver.conf",
        kplus.Volume.fromConfigMap(this, "coturn-config-vol", coturnConfigMap),
        {
          subPath: "turnserver.conf",
          readOnly: true,
        },
      );
    }

    {
      let conf = config.services.matrix.homeserverConfigPartial;
      conf.database.args.host = this.svc.db.name;

      const configmap = new kplus.ConfigMap(this, "synapse-config");
      const homeserverYaml = yaml.dump(conf);
      configmap.addData("homeserver.yaml", homeserverYaml);

      const deployment = new kplus.Deployment(this, "synapse", defaults.deployment);
      const synapse = deployment.addContainer({
        name: "synapse",
        image: "docker.io/matrixdotorg/synapse:latest",
        portNumber: 8008,
        resources: extraResourcesSpec,
        envVariables: {
          TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
          SYNAPSE_CONFIG_PATH: kplus.EnvValue.fromValue("/data/homeserver.yaml"),
        },
        ...defaults.runAsUser,
      });

      synapse.mount(
        "/data/homeserver.yaml",
        kplus.Volume.fromConfigMap(this, "synapse-config-vol", configmap),
        {
          subPath: "homeserver.yaml",
          readOnly: true,
        },
      );

      const pvc = modules.sc.createBoundPVCWithScope(this, "synapse-data", "/opt/matrix/synapse");
      synapse.mount("/data", kplus.Volume.fromPersistentVolumeClaim(this, "synapse-vol", pvc));
      modules.sc.mountEmptyDir(this, synapse, "/tmp");
      this.svc.synapse = deployment.exposeViaService({ ports: [{ port: synapse.portNumber! }] });
    }

    modules.istio.createVService(this, {
      type: "wildcard",
      serviceName: this.svc.synapse.name,
      domain: config.domains.internal.selfhostingWildcard,
      path: "/",
      subdomain: "chat",
    });
  }
}
