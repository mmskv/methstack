# methstack

> infra done right

### The DICK Stack

**D**eclarative **I**nfrastructure with **C**DK8s and **K**3s

_Size doesn't matter, declarativity does._
No [YAML hell](https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell),
just straightforward code that gets the job done.

- [k3s](https://k3s.io/).
  A very simple k8s distribution. Perfict for a small or single node cluster.
  Mostly serves as an IaC configurable docker replacement.
  - My k3s configuration: [k3s.nix](https://github.com/mmskv/dotfiles/blob/2fcd319b2c535ee869a71be0de64e7233883df2f/hosts/hosaka/k3s.nix).
    Snapshotter and containderd configuration can be skipped if not using ZFS.
  - Deploy k3s cluster with terraform in the cloud without hassle:
    [k3s-openstack-tf](https://github.com/mekstack/k3s-openstack-tf). It uses
    cloud-init to pass k3s token to all nodes aut automatically creates a
    cluster.
- [cdk8s+](https://cdk8s.io/docs/latest/plus/).
  Helm for a normal person. When used with TypeScript produces readable code
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
  Not _really_ declarative, but I can live with that.
- [cert-manager](https://cert-manager.io/docs/).
  Certbot that automatically does everything, you just have to supply
  cloudflare api token for DNS challenge. Adding new domains is _extremely_
  simple, just add a single line in cdk8s.

Not included in this repo yet

- [fleet](https://github.com/rancher/fleet). Simple and straightforward way to do GitOps.
  Example installation: [`mekstack`](https://github.com/mekstack/mekstack/blob/4746c091a2b4876fa732e9577b3143b7ccb7c01b/k8s/README.md?plain=1#L5-L19).
  Example usage: [`mekstack docs`](https://github.com/mekstack/mekstack/blob/4746c091a2b4876fa732e9577b3143b7ccb7c01b/k8s/services/docs/gitrepo.yaml).
  In a nutshell it registers a container that does `while true; git pull <your repo>; kubectl apply -f <manifests path>; done`.
  So you always get a cluster that is up-to-date with git configuration.
- [longhorn](https://longhorn.io/). Distributed k8s block storage.
  Easy to install and use. It replicates block storage across the cluster.
- [Kata Containers](https://katacontainers.io/). Drop-in replacement for containerd OCI.
  Runs pods in lightweight VMs with extremely minimal overhead. Great for
  running untrusted worloads.
- [gVisor](https://gvisor.dev/). Like Kata, but doesn't need nested
  virtualization and can easily run in clouds. Instead of running workloads
  VMs it ships a userspace kernel called Sentry written in memory-safe Go.
  Doesn't actually implement all syscalls.

## Setup

Install k3s ([example](https://github.com/mmskv/dotfiles/blob/nixos/hosts/hosaka/k3s.nix)),
then install calico and cert-manager with Helm:

```bash
helm repo add projectcalico https://docs.tigera.io/calico/charts
helm install calico projectcalico/tigera-operator \
  --version v3.29.2 \
  --create-namespace \
  --namespace tigera-operator \
  -f calico-values.yaml

helm repo add jetstack https://charts.jetstack.io --force-update
helm install \
  cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.17.1 \
  --set crds.enabled=true \
  --set prometheus.enabled=false
```

Then install istio with istioctl.
`istio-values.yaml` add HTTP(S) ports that won't be exposed on public IP.

    istioctl install -f ./istio-values.yaml

## Usage

> \>use yaml-less cdk8s \
> \>`npm synth` \
> \>look inside `dist/` \
> \>yaml

![Buy Wireless Mouse meme cat](https://i.imgflip.com/2/7nhw97.jpg)

    npm synth
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
