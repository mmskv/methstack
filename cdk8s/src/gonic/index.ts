import { cdk8s, kplus } from "@main";
import { defaults, config, modules } from "@main";

import { Construct } from "constructs";

const folders = [
  "alt",
  "ambient",
  "blackmetal",
  "DM",
  "dnb",
  "dub",
  "dubstep",
  "folk",
  "funk",
  "hardstyle",
  "hiphop",
  "idm",
  "jazz",
  "krautrock",
  "metal",
  "mixes",
  "phonk",
  "pop",
  "psy",
  "psychedelic",
  "rock",
  "shoegaze",
  "soundtrack",
  "techno",
];

const resourcesSpec = {
  cpu: {
    request: kplus.Cpu.units(4),
    limit: kplus.Cpu.units(4),
  },
  memory: {
    request: cdk8s.Size.gibibytes(4),
    limit: cdk8s.Size.gibibytes(4),
  },
};

export class Gonic extends cdk8s.Chart {
  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });
    new kplus.Namespace(this, "ns", { metadata: { name: ns } });

    const deployment = new kplus.Deployment(this, "gonic", defaults.deployment);

    const gonic = deployment.addContainer({
      name: "gonic",
      image: "sentriz/gonic:latest",
      resources: resourcesSpec,
      securityContext: {
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: false,
      },
      envVariables: {
        TZ: kplus.EnvValue.fromValue("Europe/Moscow"),
        GONIC_LISTEN_ADDR: kplus.EnvValue.fromValue("0.0.0.0:8080"),
        GONIC_SCAN_AT_START_ENABLED: kplus.EnvValue.fromValue("True"),
        GONIC_SCAN_WATCHER_ENABLED: kplus.EnvValue.fromValue("True"),
        GONIC_MULTI_VALUE_GENRE: kplus.EnvValue.fromValue("multi"),
        GONIC_MULTI_VALUE_ARTIST: kplus.EnvValue.fromValue("multi"),
        GONIC_MULTI_VALUE_ALBUM_ARTIST: kplus.EnvValue.fromValue("multi"),
        GONIC_TRANSCODE_EJECT_INTERVAL: kplus.EnvValue.fromValue("100"),

        GONIC_MUSIC_PATH: kplus.EnvValue.fromValue(
          folders.map((folder) => `${folder}->/music/${folder}`).join(","),
        ),
      },
      portNumber: 8080,
    });

    const gonicDb = modules.sc.createBoundPVCWithScope(this, "gonic-db", "/opt/gonic/db");
    const gonicCache = modules.sc.createBoundPVCWithScope(this, "gonic-cache", "/opt/gonic/cache");
    const music = modules.sc.createBoundPVCWithScope(
      this,
      "gonic-music",
      config.services.gonic.musicPath,
    );

    gonic.mount("/data", kplus.Volume.fromPersistentVolumeClaim(this, "gonic-db", gonicDb));
    gonic.mount("/cache", kplus.Volume.fromPersistentVolumeClaim(this, "gonic-cache", gonicCache));
    gonic.mount(
      "/music",
      kplus.Volume.fromPersistentVolumeClaim(this, "gonic-music", music, { readOnly: true }),
    );
    modules.sc.mountEmptyDir(this, gonic, "/playlists");
    modules.sc.mountEmptyDir(this, gonic, "/podcasts");

    const svc = deployment.exposeViaService({
      ports: [{ port: 80, targetPort: gonic.portNumber }],
    });
    modules.istio.createVService(this, {
      type: "wildcard",
      serviceName: svc.name,
      domain: config.domains.internal.selfhostingWildcard,
      subdomain: "music",
      path: "/",
    });
  }
}
