{pkgs ? import <nixpkgs-unstable> {}}:
pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    nodePackages.cdk8s-cli
    kubernetes-helm
    istioctl
    calicoctl
    k9s
  ];
}
