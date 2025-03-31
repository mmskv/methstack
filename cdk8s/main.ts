import * as cdk8s from 'cdk8s';
import * as kplus from 'cdk8s-plus-32';

export { cdk8s, kplus };

import { config } from './config';
export { config };

export const defaults = {
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
    },
  }
}

import { LocalSC } from './src/sc';
import { Istio } from './src/istio';

const app = new cdk8s.App();
export const modules = {
  sc: new LocalSC(app, 'sc'),
  istio: new Istio(app, 'istio'),
}

// Deployments depend on sc and istio
// so they are imported after them

import { Bitwarden } from './src/bw';
import { Immich } from './src/immich';
import { Adguard } from './src/adguard';
import { HomeAssistant } from './src/home-assistant';
import { MFAss } from './src/mfass';

new Immich(app, 'immich');
new Bitwarden(app, 'bw');
new Adguard(app, 'adguard');
new MFAss(app, 'mfass');
new HomeAssistant(app, 'home-assistant');

// opsec-sensitive stuff
import { PrivateDeployments } from './src/private';
new PrivateDeployments(app);

app.synth();
