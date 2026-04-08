# methstack

> infra done right

### The DICK Stack

**D**eclarative **I**nfrastructure with **C**DK8s and **K**3s

No [YAML hell](https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell),

- [k3s](https://k3s.io/).
  A very simple k8s distribution. Perfict for a small or single node cluster.
  Mostly serves as an IaC configurable docker replacement.
  - My k3s configuration: [k3s.nix](https://github.com/mmskv/dotfiles/blob/2fcd319b2c535ee869a71be0de64e7233883df2f/hosts/hosaka/k3s.nix).
    Snapshotter and containderd configuration can be skipped if not using ZFS.
- [cdk8s+](https://cdk8s.io/docs/latest/plus/).
  Helm for a sane person. When used with TypeScript produces readable code
  with type checking and autocompletion (Helm users don't know these words).
- [Istio](https://istio.io/).
  Acts mostly as an ingress gateway, but has service mesh features that will
  come in handy when you deploy microservices. Better than Traefic/Nginx
  because doesn't have to be restarted on configuration changes
- [Calico](https://docs.tigera.io/calico/latest/about).
  CNI (Container Network Interface) plugin. Has tunable NetworkPolicies for
  security. Simple to configure
- [NixOS](https://nixos.org/) with [dotfiles](https://github.com/mmskv/dotfiles).
  Declarative configuration with
  [impermanence](https://github.com/mmskv/dotfiles/blob/nixos/hosts/hosaka/impermanence.nix),
  [snapshotting](https://github.com/mmskv/dotfiles/blob/nixos/hosts/hosaka/zrepl.nix)
  and
  [hardening](https://github.com/mmskv/dotfiles/blob/nixos/common/hardening.nix)
  for the server.
- [ZFS](https://openzfs.org) as a local storage SC provider for snapshottable PVs.
- [cert-manager](https://cert-manager.io/docs/).
  Certbot that automatically does everything, you just have to supply
  cloudflare api token for DNS challenge. Adding new domains is simple, just
  add a single line in cdk8s.

## Setup

Install k3s ([example](https://github.com/mmskv/dotfiles/blob/nixos/hosts/hosaka/k3s.nix)),
then install calico and cert-manager with Helm:

```bash
helm repo add projectcalico https://docs.tigera.io/calico/charts --force-update
helm install calico projectcalico/tigera-operator \
  --version v3.31.3 \
  --create-namespace \
  --namespace tigera-operator \
  -f calico-values.yaml

helm repo add jetstack https://charts.jetstack.io --force-update
helm install \
  cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.19.2 \
  --set crds.enabled=true \
  --set prometheus.enabled=false

helm repo add stakater https://stakater.github.io/stakater-charts
helm install reloader stakater/reloader \
  -n reloader --create-namespace \
  --set reloader.watchGlobally=true
```

Then install istio with istioctl.
`istio-values.yaml` add HTTP(S) ports that won't be exposed on public IP.

    istioctl install -f ./istio-values.yaml

## Usage

> \>use yaml-less infa \
> \>`npm run synth` \
> \>look inside `dist/` \
> \>yaml

![Buy Wireless Mouse meme cat](https://i.imgflip.com/2/7nhw97.jpg)

    npm run synth
    kubectl apply -f dist/ # apply everything
    kubectl apply -f dist/mfass.yaml # or specify what to apply

> [!CAUTION]
> Deleting resources from cdk8s code doesn't remove them up from the cluster.
> This can happen after changing resource names

### Importing CRDs

When adding new CRDs, they have to be imported to cdk8s to support type
checking. Just point it to yamls with CRDs, it will modify cdk8s.yaml

    cdk8s import https://github.com/cert-manager/cert-manager/releases/download/v1.17.1/cert-manager.yaml

### Debugging

Restart, exec and inspect pods with

    k9s

For networking related problems, istioctl has options for analyzing traffic
