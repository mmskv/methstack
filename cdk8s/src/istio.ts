import { kplus, cdk8s } from '@main';

import { Construct } from 'constructs';

import * as certmanager from '@crds/cert-manager.io';
import * as istio from '@crds/networking.istio.io';

import { config } from '@main';

interface GatewayProps {
  name: string;
  hosts: string[];
  hostHttpPort: number;
  hostHttpsPort: number;
}

interface WildcardVServiceProps {
  type: 'wildcard';
  serviceName: string;
  domain: string;
  subdomain: string;
  path: string;
}

interface DomainVServiceProps {
  type: 'domain';
  serviceName: string;
  domain: string;
  path: string;
}

type VServiceProps = WildcardVServiceProps | DomainVServiceProps;

export class Istio extends cdk8s.Chart {
  public readonly externalGw: GatewayProps;
  public readonly internalGw: GatewayProps;

  cloudflareIssuer: certmanager.Issuer;

  constructor(scope: Construct, ns: string) {
    super(scope, ns, { namespace: ns, disableResourceNameHashes: true });

    const cloudflareTokenSecret = new kplus.Secret(this, 'cloudflare-api-token', {
      metadata: {
        name: 'cloudflare-api-token',
        namespace: 'istio-system',
      },
      stringData: {
        'api-token': config.cloudflareApiToken,
      }
    });

    this.cloudflareIssuer = new certmanager.Issuer(this, 'issuer', {
      metadata: {
        name: 'ca-issuer',
        namespace: 'istio-system',
      },
      spec: {
        acme: {
          server: 'https://acme-v02.api.letsencrypt.org/directory',
          privateKeySecretRef: {
            name: 'ca-issuer-private-key'
          },
          solvers: [{
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  name: cloudflareTokenSecret.name,
                  key: 'api-token'
                }
              }
            }
          }]
        }
      }
    });

    this.externalGw = {
      name: 'public-gw',
      hosts: Object.values(config.domains.external),
      hostHttpPort: 80,
      hostHttpsPort: 443
    };

    this.internalGw = {
      name: 'internal-gw',
      hosts: Object.values(config.domains.internal),
      hostHttpPort: 8080,
      hostHttpsPort: 8443
    };

    this.createGateway(this.externalGw);
    this.createGateway(this.internalGw);

    config.extraCerts.forEach(domain => {
      this.createCertificate(domain);
    })
  }

  private hostToResourceName(host: string): string {
    return host.replace(/\./g, '-').replace(/\*/g, 'wildcard');
  };

  private createCertificate(
    domain: string,
  ): certmanager.Certificate {
    const name = this.hostToResourceName(domain);

    return new certmanager.Certificate(this, name, {
      metadata: {
        name,
        namespace: 'istio-system',
      },
      spec: {
        issuerRef: {
          name: this.cloudflareIssuer.name
        },
        secretName: name,
        commonName: domain,
        dnsNames: [domain],
      }
    });
  }

  private createGateway(gateway: GatewayProps): istio.Gateway {
    const httpsServers = gateway.hosts.map(host => ({
      port: {
        number: gateway.hostHttpsPort,
        name: `https-${this.hostToResourceName(host)}`,
        protocol: 'HTTPS'
      },
      tls: {
        mode: istio.GatewaySpecServersTlsMode.SIMPLE,
        credentialName: this.createCertificate(host).name,
      },
      hosts: [host]
    }));

    return new istio.Gateway(this, gateway.name, {
      metadata: {
        name: gateway.name,
        namespace: 'istio-system',
      },
      spec: {
        servers: [
          {
            port: {
              number: gateway.hostHttpPort,
              name: 'http',
              protocol: 'HTTP'
            },
            hosts: gateway.hosts,
            tls: { httpsRedirect: true }
          },
          ...httpsServers,
        ]
      }
    });
  }

  // Create a VirtualService for a service
  // Automatically determines the correct Gateway based on the domain
  public createVService(
    scope: Construct,
    vs: VServiceProps
  ): istio.VirtualService {
    let host;
    if (vs.type === 'wildcard') {
      if (!vs.domain.startsWith('*.')) {
        throw new Error('Wildcard VirtualService must have a domain starting with "*."');
      }
      host = vs.domain.replace('*', vs.subdomain);
    } else {
      if (vs.domain.startsWith('*.')) {
        throw new Error('Domain-based VirtualService must not have a domain starting with "*."');
      }
      host = vs.domain;
    }

    let gateway;
    if (Object.values(config.domains.external).includes(vs.domain)) {
      gateway = this.externalGw;
    } else if (Object.values(config.domains.internal).includes(vs.domain)) {
      gateway = this.internalGw;
    } else {
      throw new Error(`Domain ${vs.domain} not found in config`);
    }

    return new istio.VirtualService(scope, `${vs.serviceName}-vs`, {
      metadata: {
        name: `${vs.serviceName}-vs`,
      },
      spec: {
        hosts: [host],
        gateways: [`istio-system/${gateway.name}`],
        http: [{
          match: [{ uri: { prefix: vs.path } }],
          route: [{ destination: { host: vs.serviceName } }]
        }]
      }
    });
  }
}
