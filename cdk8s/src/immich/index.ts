import { cdk8s, kplus } from '@main';
import { defaults, config, modules } from '@main';

import { Construct } from 'constructs';

const extraResourcesSpec = {
  cpu: {
    request: kplus.Cpu.units(8),
    limit: kplus.Cpu.units(8),
  },
  memory: {
    request: cdk8s.Size.gibibytes(8),
    limit: cdk8s.Size.gibibytes(8),
  }
};

export class Immich extends cdk8s.Chart {
  svc: Record<string, kplus.Service> = {};

  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, 'ns', { metadata: { name: ns } });

    // Database
    {
      const deployment = new kplus.Deployment(this, 'db', {
        ...defaults.deployment,
      });
      const postgres = deployment.addContainer({
        name: "postgres",
        image: "docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0@sha256:90724186f0a3517cf6914295b5ab410db9ce23190a2d9d0b9dd6463e3fa298f0",
        command: ["postgres"],
        args: [
          "-c", "shared_preload_libraries=vectors.so",
          "-c", "search_path=\"$user\", public, vectors",
          "-c", "logging_collector=off",
          "-c", "max_wal_size=2GB",
          "-c", "shared_buffers=512MB",
          "-c", "wal_compression=on"
        ],
        envVariables: {
          POSTGRES_INITDB_ARGS: kplus.EnvValue.fromValue('--data-checksums'),
          ...config.services.immich.db.envCredVars,
        },
        securityContext: {
          user: 999,
          group: 999,
        },
        portNumber: 5432,
      });
      const pgData = modules.sc.createBoundPVCWithScope(this, 'postgres', '/opt/immich/postgres');
      postgres.mount('/var/lib/postgresql/data', kplus.Volume.fromPersistentVolumeClaim(this, 'postgres-vol', pgData));
      modules.sc.mountEmptyDir(this, postgres, '/var/run/postgresql');
      this.svc.db = deployment.exposeViaService({ ports: [{ port: postgres.portNumber! }] });
    }

    // Redis
    {
      const deployment = new kplus.Deployment(this, 'redis', defaults.deployment);
      const redis = deployment.addContainer({
        name: "redis",
        image: "docker.io/redis:6.2-alpine@sha256:905c4ee67b8e0aa955331960d2aa745781e6bd89afc44a8584bfd13bc890f0ae",
        command: ["redis-server"],
        args: [
          "--appendonly yes",
          "--appendfsync everysec",
          "--dir /data"
        ],
        portNumber: 6379,
        ...defaults.runAsUser
      });
      const redisData = modules.sc.createBoundPVCWithScope(this, 'redis', '/opt/immich/redis');
      redis.mount('/data', kplus.Volume.fromPersistentVolumeClaim(this, 'redis-vol', redisData));
      this.svc.redis = deployment.exposeViaService({ ports: [{ port: redis.portNumber! }] });
    }

    const sharedConfig = {
      TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
      REDIS_HOSTNAME: kplus.EnvValue.fromValue(this.svc.redis.name),
      REDIS_PORT: kplus.EnvValue.fromValue(this.svc.redis.port.toString()),
      DB_HOSTNAME: kplus.EnvValue.fromValue(this.svc.db.name),
      ...config.services.immich.server.envDbCreds,
    };

    // Machine Learning
    {
      const deployment = new kplus.Deployment(this, 'machine-learning', defaults.deployment);
      const ml = deployment.addContainer({
        name: "machine-learning",
        image: 'ghcr.io/immich-app/immich-machine-learning:release',
        envVariables: sharedConfig,
        resources: extraResourcesSpec,
        portNumber: 3003,
        ...defaults.runAsUser
      });
      const cache = modules.sc.createBoundPVCWithScope(this, 'ml-cache', '/opt/immich/ml');
      ml.mount('/cache', kplus.Volume.fromPersistentVolumeClaim(this, 'ml-vol', cache));
      modules.sc.mountEmptyDir(this, ml, '/tmp');
      deployment.exposeViaService({ ports: [{ port: ml.portNumber! }] });
    }

    // Immich Server
    {
      const deployment = new kplus.Deployment(this, 'server', defaults.deployment);
      const server = deployment.addContainer({
        name: "server",
        image: 'ghcr.io/immich-app/immich-server:release',
        envVariables: sharedConfig,
        portNumber: 2283,
        resources: extraResourcesSpec,
        ...defaults.runAsUser
      });
      const upload = modules.sc.createBoundPVCWithScope(this, 'immich-upload', '/opt/immich/upload');
      server.mount('/usr/src/app/upload', kplus.Volume.fromPersistentVolumeClaim(this, 'upload-vol', upload));

      const svc = deployment.exposeViaService({ ports: [{ port: 80, targetPort: server.portNumber! }] });
      modules.istio.createVService(this, {
        type: 'wildcard',
        serviceName: svc.name,
        domain: config.domains.internal.selfhostingWildcard,
        path: '/',
        subdomain: 'immich',
      });
    }
  }
}
