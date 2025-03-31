import { cdk8s, kplus } from '@main';

import { Construct } from 'constructs';

// LocalSC works great for a single node cluster
export class LocalSC extends cdk8s.Chart {
  static defaultMode = kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE_POD;

  public readonly name: string;

  constructor(scope: Construct, id: string) {
    super(scope, id, { disableResourceNameHashes: true });

    const localStorageClass = new kplus.k8s.KubeStorageClass(this, 'local', {
      provisioner: 'kubernetes.io/no-provisioner',
      volumeBindingMode: "WaitForFirstConsumer"
    });

    this.name = localStorageClass.name;
  }

  public createBoundPVCWithScope(
    scope: Construct,
    name: string,
    localPath: string,
    accessMode: kplus.PersistentVolumeAccessMode = LocalSC.defaultMode
  ): kplus.IPersistentVolumeClaim {
    const rawPV = new kplus.k8s.KubePersistentVolume(scope, `${name}-raw-pv`, {
      metadata: {
        name: name,
      },
      spec: {
        volumeMode: 'Filesystem',
        accessModes: [accessMode],
        persistentVolumeReclaimPolicy: 'Retain',
        storageClassName: this.name,
        capacity: {
          storage: kplus.k8s.Quantity.fromString("1Gi"),
        },
        local: {
          path: localPath,
        },
        nodeAffinity: {
          required: {
            nodeSelectorTerms: [{
              matchExpressions: [{
                key: 'kubernetes.io/hostname',
                operator: 'In',
                values: ['hosaka'],
              }],
            }],
          },
        },
      },
    });

    // reimport as kplus resource
    const pv = kplus.PersistentVolume.fromPersistentVolumeName(scope, `${name}-pv`, rawPV.name);
    const claim = new kplus.PersistentVolumeClaim(scope, `${name}-claim`, {
      storageClassName: this.name,
      storage: cdk8s.Size.gibibytes(1),
      accessModes: [accessMode]
    });

    claim.bind(pv);

    return claim;
  }

  public mountEmptyDir(scope: Construct, container: kplus.Container, path: string) {
    const name = path.slice(1).replace(/\//g, '-') + '-emptydir';
    container.mount(path, kplus.Volume.fromEmptyDir(scope, name, name, { medium: kplus.EmptyDirMedium.MEMORY }));
  }
}
