import { kplus } from "@main";
import { defaults, config, env, ServiceChart, Construct } from "@main";

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

export class Gonic extends ServiceChart {
  public svc!: kplus.Service;

  constructor(scope: Construct, ns: string) {
    super(scope, ns);

    const deployment = this.deploy("gonic");
    const gonic = deployment.addContainer({
      name: "gonic",
      image: "sentriz/gonic:latest",
      resources: defaults.resources.medium,
      securityContext: { user: 169, group: 169 },
      envVariables: {
        TZ: env("Europe/Moscow"),
        GONIC_LISTEN_ADDR: env("0.0.0.0:8080"),
        GONIC_SCAN_AT_START_ENABLED: env("True"),
        GONIC_SCAN_WATCHER_ENABLED: env("True"),
        GONIC_MULTI_VALUE_GENRE: env("multi"),
        GONIC_MULTI_VALUE_ARTIST: env("multi"),
        GONIC_MULTI_VALUE_ALBUM_ARTIST: env("multi"),
        GONIC_TRANSCODE_EJECT_INTERVAL: env("100"),
        GONIC_MUSIC_PATH: env(folders.map((folder) => `${folder}->/music/${folder}`).join(",")),
      },
      portNumber: 8080,
    });

    this.mountPVC(gonic, "gonic-db", "/opt/gonic/db", "/data");
    this.mountPVC(gonic, "gonic-cache", "/opt/gonic/cache", "/cache");
    this.mountPVC(gonic, "gonic-music", config.services.gonic.musicPath, "/music", {
      readOnly: true,
    });
    this.mountEmptyDir(gonic, "/playlists");
    this.mountEmptyDir(gonic, "/podcasts");
    this.mountTmp(gonic);

    this.svc = this.exposeInternal(deployment, { port: 80, targetPort: 8080 }, "music");
  }
}
