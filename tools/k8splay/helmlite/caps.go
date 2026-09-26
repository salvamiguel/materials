package helmlite

// Capabilities of the simulated cluster, as .Capabilities in templates
// (Helm's chartutil.Capabilities without the discovery client).

// KubeVersion is the Kubernetes version of the cluster.
type KubeVersion struct {
	Version string `json:"version"`
	Major   string `json:"major"`
	Minor   string `json:"minor"`
}

// String implements fmt.Stringer.
func (kv *KubeVersion) String() string { return kv.Version }

// GitVersion returns the Kubernetes version string (deprecated alias of Version).
func (kv *KubeVersion) GitVersion() string { return kv.Version }

// VersionSet is the set of API versions the cluster serves.
type VersionSet []string

// Has reports whether the set contains the version.
func (v VersionSet) Has(apiVersion string) bool {
	for _, x := range v {
		if x == apiVersion {
			return true
		}
	}
	return false
}

// BuildInfo describes the Helm build.
type BuildInfo struct {
	Version      string `json:"version,omitempty"`
	GitCommit    string `json:"git_commit,omitempty"`
	GitTreeState string `json:"git_tree_state,omitempty"`
	GoVersion    string `json:"go_version,omitempty"`
}

// Capabilities describes the capabilities of the Kubernetes cluster.
type Capabilities struct {
	KubeVersion KubeVersion
	APIVersions VersionSet
	HelmVersion BuildInfo
}

// DefaultCapabilities matches the playground's cluster (Kubernetes 1.33).
var DefaultCapabilities = &Capabilities{
	KubeVersion: KubeVersion{Version: "v1.33.1", Major: "1", Minor: "33"},
	APIVersions: VersionSet{
		"v1", "apps/v1", "batch/v1", "autoscaling/v1", "autoscaling/v2", "networking.k8s.io/v1",
		"storage.k8s.io/v1", "policy/v1", "rbac.authorization.k8s.io/v1", "apps/v1/Deployment",
		"apps/v1/StatefulSet", "apps/v1/DaemonSet", "batch/v1/Job", "batch/v1/CronJob", "v1/Service",
		"v1/ConfigMap", "v1/Secret", "networking.k8s.io/v1/Ingress", "autoscaling/v2/HorizontalPodAutoscaler",
	},
	HelmVersion: BuildInfo{Version: "v3.17.0", GitCommit: "playground", GitTreeState: "clean", GoVersion: "go1.24"},
}
