import { kplus } from "@main";
import { defaults, config, env, ServiceChart, Construct } from "@main";

export class Immich extends ServiceChart {
  svc: Record<string, kplus.Service> = {};

  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    this.createDatabase();
    this.createRedis();
    this.createMachineLearning();
    this.createServer();
  }

  private createDatabase() {
    const { svc } = this.postgres("db", {
      image:
        "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23",
      creds: {
        POSTGRES_INITDB_ARGS: env("--data-checksums"),
        ...config.services.immich.db.envCredVars,
      },
      dataPath: "/opt/immich/postgres/data",
      pvcName: "postgres-data",
      extraMounts: (pg) => {
        this.mountPVC(pg, "postgres-config", "/opt/immich/postgres/config", "/etc/postgresql");
      },
    });
    this.svc.db = svc;
  }

  private createRedis() {
    const deployment = this.deploy("redis");
    const redis = deployment.addContainer({
      name: "redis",
      image:
        "docker.io/valkey/valkey:9@sha256:fb8d272e529ea567b9bf1302245796f21a2672b8368ca3fcb938ac334e613c8f",
      portNumber: 6379,
      resources: defaults.resources.tiny,
      ...defaults.runAsUser,
    });
    this.mountEmptyDir(redis, "/data");
    this.svc.redis = deployment.exposeViaService({ ports: [{ port: 6379 }] });
  }

  private sharedConfig() {
    return {
      TZ: env("Europe/Moscow"),
      REDIS_HOSTNAME: env(this.svc.redis.name),
      REDIS_PORT: env(this.svc.redis.port.toString()),
      DB_HOSTNAME: env(this.svc.db.name),
      UPLOAD_LOCATION: env("library"),
      ...config.services.immich.server.envDbCreds,
    };
  }

  private createMachineLearning() {
    const deployment = this.deploy("machine-learning");
    const ml = deployment.addContainer({
      name: "machine-learning",
      image: "ghcr.io/immich-app/immich-machine-learning:release",
      envVariables: this.sharedConfig(),
      resources: defaults.resources.large,
      portNumber: 3003,
      ...defaults.runAsUser,
    });
    this.mountPVC(ml, "ml-cache", "/opt/immich/mlcache", "/cache");
    this.mountTmp(ml);
    this.mountEmptyDir(ml, "/.config");
    this.mountEmptyDir(ml, "/.cache");
    deployment.exposeViaService({ ports: [{ port: 3003 }] });
  }

  private createServer() {
    const deployment = this.deploy("server");
    const server = deployment.addContainer({
      name: "server",
      image: "ghcr.io/immich-app/immich-server:release",
      envVariables: this.sharedConfig(),
      portNumber: 2283,
      resources: defaults.resources.medium,
      ...defaults.runAsUser,
    });
    this.mountPVC(server, "immich-upload", "/opt/immich/data", "/data");

    this.svc.server = this.exposeInternal(deployment, { port: 80, targetPort: 2283 }, "pics");
  }
}
