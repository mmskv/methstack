import { cdk8s, kplus } from "@main";
import { defaults, config, modules } from "@main";

import { Construct } from "constructs";

const extraResourcesSpec = {
  cpu: {
    request: kplus.Cpu.units(2),
    limit: kplus.Cpu.units(16),
  },
  memory: {
    request: cdk8s.Size.gibibytes(4),
    limit: cdk8s.Size.gibibytes(16),
  },
};

export class Immich extends cdk8s.Chart {
  svc: Record<string, kplus.Service> = {};

  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    // Database
    {
      const deployment = new kplus.Deployment(this, "db", {
        ...defaults.deployment,
      });
      const postgres = deployment.addContainer({
        name: "postgres",
        image:
          "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23",
        envVariables: {
          POSTGRES_INITDB_ARGS: kplus.EnvValue.fromValue("--data-checksums"),
          ...config.services.immich.db.envCredVars,
        },
        securityContext: {
          user: 999,
          group: 999,
        },
        portNumber: 5432,
      });

      const pgData = modules.sc.createBoundPVCWithScope(
        this,
        "postgres-data",
        "/opt/immich/postgres/data",
      );
      postgres.mount(
        "/var/lib/postgresql/data",
        kplus.Volume.fromPersistentVolumeClaim(this, "postgres-vol-data", pgData),
      );

      const pgConfig = modules.sc.createBoundPVCWithScope(
        this,
        "postgres-config",
        "/opt/immich/postgres/config",
      );
      postgres.mount(
        "/etc/postgresql",
        kplus.Volume.fromPersistentVolumeClaim(this, "postgres-vol-config", pgConfig),
      );

      modules.sc.mountEmptyDir(this, postgres, "/var/run/postgresql");
      this.svc.db = deployment.exposeViaService({ ports: [{ port: postgres.portNumber! }] });
    }

    // Redis
    {
      const deployment = new kplus.Deployment(this, "redis", defaults.deployment);
      const redis = deployment.addContainer({
        name: "redis",
        image:
          "docker.io/valkey/valkey:9@sha256:fb8d272e529ea567b9bf1302245796f21a2672b8368ca3fcb938ac334e613c8f",
        portNumber: 6379,
        ...defaults.runAsUser,
      });
      modules.sc.mountEmptyDir(this, redis, "/data");
      this.svc.redis = deployment.exposeViaService({ ports: [{ port: redis.portNumber! }] });
    }

    const sharedConfig = {
      TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
      REDIS_HOSTNAME: kplus.EnvValue.fromValue(this.svc.redis.name),
      REDIS_PORT: kplus.EnvValue.fromValue(this.svc.redis.port.toString()),
      DB_HOSTNAME: kplus.EnvValue.fromValue(this.svc.db.name),
      UPLOAD_LOCATION: kplus.EnvValue.fromValue("library"),
      ...config.services.immich.server.envDbCreds,
    };

    // Machine Learning
    {
      const deployment = new kplus.Deployment(this, "machine-learning", defaults.deployment);
      const ml = deployment.addContainer({
        name: "machine-learning",
        image: "ghcr.io/immich-app/immich-machine-learning:release",
        envVariables: sharedConfig,
        resources: extraResourcesSpec,
        portNumber: 3003,
        ...defaults.runAsUser,
      });
      const cache = modules.sc.createBoundPVCWithScope(this, "ml-cache", "/opt/immich/mlcache");
      ml.mount("/cache", kplus.Volume.fromPersistentVolumeClaim(this, "ml-vol", cache));
      modules.sc.mountEmptyDir(this, ml, "/tmp");
      modules.sc.mountEmptyDir(this, ml, "/.config");
      modules.sc.mountEmptyDir(this, ml, "/.cache");
      deployment.exposeViaService({ ports: [{ port: ml.portNumber! }] });
    }

    // Immich Server
    {
      const deployment = new kplus.Deployment(this, "server", defaults.deployment);
      const server = deployment.addContainer({
        name: "server",
        image: "ghcr.io/immich-app/immich-server:release",
        envVariables: sharedConfig,
        portNumber: 2283,
        resources: extraResourcesSpec,
        ...defaults.runAsUser,
      });
      const upload = modules.sc.createBoundPVCWithScope(this, "immich-upload", "/opt/immich/data");
      server.mount("/data", kplus.Volume.fromPersistentVolumeClaim(this, "upload-vol", upload));

      const svc = deployment.exposeViaService({
        ports: [{ port: 80, targetPort: server.portNumber! }],
      });
      modules.istio.createVService(this, {
        type: "wildcard",
        serviceName: svc.name,
        domain: config.domains.internal.selfhostingWildcard,
        path: "/",
        subdomain: "pics",
      });
    }
  }
}
