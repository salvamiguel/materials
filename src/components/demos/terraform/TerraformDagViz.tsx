import React, { useState, useRef, useEffect } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

interface Resource {
  id: string;
  type: string;
  name: string;
  dependsOn: string[];
  color: string;
}

interface NodePos {
  x: number;
  y: number;
  layer: number;
}

const PRESETS: Record<string, Resource[]> = {
  webapp: [
    { id: "vpc", type: "aws_vpc", name: "main", dependsOn: [], color: "#c678dd" },
    { id: "subnet_pub", type: "aws_subnet", name: "public", dependsOn: ["vpc"], color: "#61afef" },
    { id: "subnet_priv", type: "aws_subnet", name: "private", dependsOn: ["vpc"], color: "#61afef" },
    { id: "igw", type: "aws_internet_gateway", name: "main", dependsOn: ["vpc"], color: "#56b6c2" },
    { id: "sg", type: "aws_security_group", name: "web", dependsOn: ["vpc"], color: "#e5c07b" },
    { id: "instance", type: "aws_instance", name: "web", dependsOn: ["subnet_pub", "sg"], color: "#98c379" },
    { id: "eip", type: "aws_eip", name: "web", dependsOn: ["instance", "igw"], color: "#d19a66" },
    { id: "rds", type: "aws_db_instance", name: "main", dependsOn: ["subnet_priv", "sg"], color: "#e06c75" },
  ],
  eks: [
    { id: "vpc", type: "aws_vpc", name: "eks", dependsOn: [], color: "#c678dd" },
    { id: "subnet_a", type: "aws_subnet", name: "a", dependsOn: ["vpc"], color: "#61afef" },
    { id: "subnet_b", type: "aws_subnet", name: "b", dependsOn: ["vpc"], color: "#61afef" },
    { id: "iam_role", type: "aws_iam_role", name: "eks", dependsOn: [], color: "#e5c07b" },
    { id: "iam_policy", type: "aws_iam_role_policy_attachment", name: "eks", dependsOn: ["iam_role"], color: "#e5c07b" },
    { id: "cluster", type: "aws_eks_cluster", name: "main", dependsOn: ["subnet_a", "subnet_b", "iam_policy"], color: "#98c379" },
    { id: "node_group", type: "aws_eks_node_group", name: "workers", dependsOn: ["cluster"], color: "#d19a66" },
  ],
  simple: [
    { id: "vpc", type: "aws_vpc", name: "main", dependsOn: [], color: "#c678dd" },
    { id: "subnet", type: "aws_subnet", name: "main", dependsOn: ["vpc"], color: "#61afef" },
    { id: "instance", type: "aws_instance", name: "web", dependsOn: ["subnet"], color: "#98c379" },
  ],
  "gcp-webapp": [
    { id: "network", type: "google_compute_network", name: "main", dependsOn: [], color: "#c678dd" },
    { id: "subnet", type: "google_compute_subnetwork", name: "public", dependsOn: ["network"], color: "#61afef" },
    { id: "firewall", type: "google_compute_firewall", name: "web", dependsOn: ["network"], color: "#e5c07b" },
    { id: "instance", type: "google_compute_instance", name: "web", dependsOn: ["subnet", "firewall"], color: "#98c379" },
    { id: "ip", type: "google_compute_address", name: "web", dependsOn: [], color: "#d19a66" },
    { id: "sql", type: "google_sql_database_instance", name: "main", dependsOn: ["network"], color: "#e06c75" },
    { id: "db", type: "google_sql_database", name: "app", dependsOn: ["sql"], color: "#e06c75" },
  ],
  "gcp-gke": [
    { id: "network", type: "google_compute_network", name: "gke", dependsOn: [], color: "#c678dd" },
    { id: "subnet", type: "google_compute_subnetwork", name: "gke", dependsOn: ["network"], color: "#61afef" },
    { id: "sa", type: "google_service_account", name: "gke", dependsOn: [], color: "#e5c07b" },
    { id: "cluster", type: "google_container_cluster", name: "main", dependsOn: ["subnet", "sa"], color: "#98c379" },
    { id: "nodepool", type: "google_container_node_pool", name: "workers", dependsOn: ["cluster"], color: "#d19a66" },
  ],
  "azure-webapp": [
    { id: "rg", type: "azurerm_resource_group", name: "main", dependsOn: [], color: "#c678dd" },
    { id: "vnet", type: "azurerm_virtual_network", name: "main", dependsOn: ["rg"], color: "#61afef" },
    { id: "subnet", type: "azurerm_subnet", name: "web", dependsOn: ["vnet"], color: "#61afef" },
    { id: "nsg", type: "azurerm_network_security_group", name: "web", dependsOn: ["rg"], color: "#e5c07b" },
    { id: "nic", type: "azurerm_network_interface", name: "web", dependsOn: ["subnet", "nsg"], color: "#56b6c2" },
    { id: "vm", type: "azurerm_linux_virtual_machine", name: "web", dependsOn: ["nic"], color: "#98c379" },
    { id: "pip", type: "azurerm_public_ip", name: "web", dependsOn: ["rg"], color: "#d19a66" },
    { id: "sql", type: "azurerm_mssql_server", name: "main", dependsOn: ["rg"], color: "#e06c75" },
    { id: "db", type: "azurerm_mssql_database", name: "app", dependsOn: ["sql"], color: "#e06c75" },
  ],
  "azure-aks": [
    { id: "rg", type: "azurerm_resource_group", name: "aks", dependsOn: [], color: "#c678dd" },
    { id: "vnet", type: "azurerm_virtual_network", name: "aks", dependsOn: ["rg"], color: "#61afef" },
    { id: "subnet", type: "azurerm_subnet", name: "aks", dependsOn: ["vnet"], color: "#61afef" },
    { id: "identity", type: "azurerm_user_assigned_identity", name: "aks", dependsOn: ["rg"], color: "#e5c07b" },
    { id: "cluster", type: "azurerm_kubernetes_cluster", name: "main", dependsOn: ["subnet", "identity"], color: "#98c379" },
  ],
};

function computeLayers(resources: Resource[]): Map<string, number> {
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function getLayer(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    const res = resources.find((r) => r.id === id);
    if (!res || res.dependsOn.length === 0) {
      layers.set(id, 0);
      return 0;
    }

    const maxDep = Math.max(...res.dependsOn.filter((d) => resources.find((r) => r.id === d)).map(getLayer));
    const layer = maxDep + 1;
    layers.set(id, layer);
    return layer;
  }

  resources.forEach((r) => getLayer(r.id));
  return layers;
}

function layoutNodes(resources: Resource[]): Map<string, NodePos> {
  const layers = computeLayers(resources);
  const maxLayer = Math.max(0, ...layers.values());
  const positions = new Map<string, NodePos>();

  const byLayer: Resource[][] = Array.from({ length: maxLayer + 1 }, () => []);
  resources.forEach((r) => {
    const l = layers.get(r.id) || 0;
    byLayer[l].push(r);
  });

  const nodeW = 220;
  const nodeH = 50;
  const layerGap = 100;
  const nodeGap = 30;

  byLayer.forEach((layerResources, layerIdx) => {
    const totalH = layerResources.length * nodeH + (layerResources.length - 1) * nodeGap;
    const startY = -totalH / 2;

    layerResources.forEach((r, i) => {
      positions.set(r.id, {
        x: layerIdx * (nodeW + layerGap),
        y: startY + i * (nodeH + nodeGap),
        layer: layerIdx,
      });
    });
  });

  return positions;
}

function DAGCanvas({
  resources,
  animatingCreate,
  animatingDestroy,
  activeNode,
  onNodeClick,
}: {
  resources: Resource[];
  animatingCreate: string[];
  animatingDestroy: string[];
  activeNode: string | null;
  onNodeClick: (id: string | null) => void;
}) {
  const positions = layoutNodes(resources);
  const nodeW = 220;
  const nodeH = 50;

  // Compute SVG bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  positions.forEach((pos) => {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + nodeW);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y + nodeH);
  });

  const pad = 30;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + nodeW + pad * 2 - nodeW;
  const vbH = maxY - minY + nodeH + pad * 2 - nodeH;

  const getCreateIdx = (id: string) => animatingCreate.indexOf(id);
  const getDestroyIdx = (id: string) => animatingDestroy.indexOf(id);

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ width: "100%", height: 320, display: "block" }}
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#636a76" />
        </marker>
        <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#61afef" />
        </marker>
      </defs>

      {/* Edges */}
      {resources.map((r) =>
        r.dependsOn
          .filter((depId) => positions.has(depId))
          .map((depId) => {
            const from = positions.get(depId)!;
            const to = positions.get(r.id)!;
            const isActive = activeNode === r.id || activeNode === depId;
            const x1 = from.x + nodeW;
            const y1 = from.y + nodeH / 2;
            const x2 = to.x;
            const y2 = to.y + nodeH / 2;
            const midX = (x1 + x2) / 2;

            return (
              <path
                key={`${depId}-${r.id}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={isActive ? "#61afef" : "#636a7640"}
                strokeWidth={isActive ? 2 : 1.5}
                markerEnd={isActive ? "url(#arrowhead-active)" : "url(#arrowhead)"}
                style={{ transition: "all 0.3s ease" }}
              />
            );
          })
      )}

      {/* Nodes */}
      {resources.map((r) => {
        const pos = positions.get(r.id);
        if (!pos) return null;
        const isActive = activeNode === r.id;
        const createIdx = getCreateIdx(r.id);
        const destroyIdx = getDestroyIdx(r.id);
        const isCreating = createIdx >= 0;
        const isDestroying = destroyIdx >= 0;

        let borderColor = r.color + "60";
        let bg = "#1e2028";
        if (isActive) { borderColor = r.color; bg = r.color + "15"; }
        if (isCreating) { borderColor = "#98c379"; bg = "#98c37920"; }
        if (isDestroying) { borderColor = "#e06c75"; bg = "#e06c7520"; }

        return (
          <g
            key={r.id}
            onClick={() => onNodeClick(isActive ? null : r.id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={pos.x}
              y={pos.y}
              width={nodeW}
              height={nodeH}
              rx={8}
              fill={bg}
              stroke={borderColor}
              strokeWidth={isActive || isCreating || isDestroying ? 2 : 1}
              style={{ transition: "all 0.3s ease" }}
            />
            {/* Step badge */}
            {(isCreating || isDestroying) && (
              <>
                <circle
                  cx={pos.x + nodeW - 8}
                  cy={pos.y + 8}
                  r={10}
                  fill={isCreating ? "#98c379" : "#e06c75"}
                />
                <text
                  x={pos.x + nodeW - 8}
                  y={pos.y + 12}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily={FONT}
                  fontWeight={700}
                  fill="#16181d"
                >
                  {isCreating ? createIdx + 1 : destroyIdx + 1}
                </text>
              </>
            )}
            <text
              x={pos.x + 12}
              y={pos.y + 20}
              fontSize={10}
              fontFamily={FONT}
              fill={r.color}
              fontWeight={600}
            >
              {r.type}
            </text>
            <text
              x={pos.x + 12}
              y={pos.y + 36}
              fontSize={11}
              fontFamily={FONT}
              fill="#abb2bf"
            >
              {r.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function topoSort(resources: Resource[]): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const ids = new Set(resources.map((r) => r.id));

  resources.forEach((r) => {
    inDeg.set(r.id, 0);
    adj.set(r.id, []);
  });

  resources.forEach((r) => {
    r.dependsOn.filter((d) => ids.has(d)).forEach((d) => {
      adj.get(d)!.push(r.id);
      inDeg.set(r.id, (inDeg.get(r.id) || 0) + 1);
    });
  });

  const queue: string[] = [];
  inDeg.forEach((deg, id) => { if (deg === 0) queue.push(id); });

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    adj.get(node)?.forEach((child) => {
      const newDeg = (inDeg.get(child) || 1) - 1;
      inDeg.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    });
  }

  return order;
}

export default function TerraformDagViz() {
  const [preset, setPreset] = useState<keyof typeof PRESETS>("webapp");
  const [resources, setResources] = useState<Resource[]>(PRESETS.webapp);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [animatingCreate, setAnimatingCreate] = useState<string[]>([]);
  const [animatingDestroy, setAnimatingDestroy] = useState<string[]>([]);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const selectPreset = (key: keyof typeof PRESETS) => {
    stopAnimation();
    setPreset(key);
    setResources(PRESETS[key]);
    setActiveNode(null);
  };

  const stopAnimation = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setAnimatingCreate([]);
    setAnimatingDestroy([]);
    setAnimating(false);
  };

  const animateCreate = () => {
    stopAnimation();
    setAnimating(true);
    const order = topoSort(resources);
    let step = 1;
    setAnimatingCreate([order[0]]);

    timerRef.current = setInterval(() => {
      if (step < order.length) {
        const id = order[step];
        setAnimatingCreate((prev) => [...prev, id]);
        step++;
      } else {
        clearInterval(timerRef.current);
        setTimeout(() => setAnimating(false), 800);
      }
    }, 500);
  };

  const animateDestroy = () => {
    stopAnimation();
    setAnimating(true);
    const order = topoSort(resources).reverse();
    let step = 1;
    setAnimatingDestroy([order[0]]);

    timerRef.current = setInterval(() => {
      if (step < order.length) {
        const id = order[step];
        setAnimatingDestroy((prev) => [...prev, id]);
        step++;
      } else {
        clearInterval(timerRef.current);
        setTimeout(() => setAnimating(false), 800);
      }
    }, 500);
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const activeRes = activeNode ? resources.find((r) => r.id === activeNode) : null;
  const createOrder = topoSort(resources);
  const destroyOrder = [...createOrder].reverse();

  return (
    <DemoWrapper
      title="DAG de Recursos"
      description="Visualiza el grafo de dependencias y el orden de creación/destrucción"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.keys(PRESETS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => selectPreset(key as keyof typeof PRESETS)}
                style={{
                  fontFamily: FONT,
                  fontSize: 11,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: `1px solid ${preset === key ? "var(--ifm-color-primary)" : "#3a3d47"}`,
                  background: preset === key ? "var(--ifm-color-primary)" : "transparent",
                  color: preset === key ? "#16181d" : "#abb2bf",
                  cursor: "pointer",
                  fontWeight: preset === key ? 600 : 400,
                }}
              >
                {key}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={animateCreate}
              disabled={animating}
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: animating ? "#2a2d37" : "#98c379",
                color: animating ? "#636a76" : "#16181d",
                cursor: animating ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              terraform apply
            </button>
            <button
              type="button"
              onClick={animateDestroy}
              disabled={animating}
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: animating ? "#2a2d37" : "#e06c75",
                color: animating ? "#636a76" : "#16181d",
                cursor: animating ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              terraform destroy
            </button>
            {animating && (
              <button
                type="button"
                onClick={stopAnimation}
                style={{
                  fontFamily: FONT,
                  fontSize: 11,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid #3a3d47",
                  background: "transparent",
                  color: "#636a76",
                  cursor: "pointer",
                }}
              >
                stop
              </button>
            )}
          </div>
        </div>

        {/* DAG */}
        <div
          style={{
            background: "#16181d",
            borderRadius: 10,
            border: "1px solid #2a2d37",
            padding: 8,
            overflow: "hidden",
          }}
        >
          <DAGCanvas
            resources={resources}
            animatingCreate={animatingCreate}
            animatingDestroy={animatingDestroy}
            activeNode={activeNode}
            onNodeClick={setActiveNode}
          />
        </div>

        {/* Info panel */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: activeRes ? "1fr 1fr" : "1fr",
            gap: 12,
          }}
        >
          {/* Order lists */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div
              style={{
                background: "#1e2028",
                borderRadius: 8,
                border: "1px solid #2a2d37",
                padding: "10px 14px",
              }}
            >
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#98c379",
                  marginBottom: 6,
                }}
              >
                Orden de creacion
              </div>
              {createOrder.map((id, i) => {
                const r = resources.find((res) => res.id === id);
                const isAnimated = animatingCreate.includes(id);
                return (
                  <div
                    key={id}
                    style={{
                      fontFamily: FONT,
                      fontSize: 11,
                      color: isAnimated ? "#98c379" : "#636a76",
                      padding: "2px 0",
                      fontWeight: isAnimated ? 600 : 400,
                      transition: "all 0.3s",
                    }}
                  >
                    <span style={{ color: "#636a76", marginRight: 6 }}>{i + 1}.</span>
                    {r?.type}.{r?.name}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                background: "#1e2028",
                borderRadius: 8,
                border: "1px solid #2a2d37",
                padding: "10px 14px",
              }}
            >
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#e06c75",
                  marginBottom: 6,
                }}
              >
                Orden de destruccion
              </div>
              {destroyOrder.map((id, i) => {
                const r = resources.find((res) => res.id === id);
                const isAnimated = animatingDestroy.includes(id);
                return (
                  <div
                    key={id}
                    style={{
                      fontFamily: FONT,
                      fontSize: 11,
                      color: isAnimated ? "#e06c75" : "#636a76",
                      padding: "2px 0",
                      fontWeight: isAnimated ? 600 : 400,
                      transition: "all 0.3s",
                    }}
                  >
                    <span style={{ color: "#636a76", marginRight: 6 }}>{i + 1}.</span>
                    {r?.type}.{r?.name}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Node detail */}
          {activeRes && (
            <div
              style={{
                background: "#1e2028",
                borderRadius: 8,
                border: `1px solid ${activeRes.color}40`,
                padding: "10px 14px",
              }}
            >
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: activeRes.color,
                  marginBottom: 8,
                }}
              >
                Detalle del recurso
              </div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: "#e8e8e8", marginBottom: 4 }}>
                {activeRes.type}.{activeRes.name}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: "#636a76", marginBottom: 8 }}>
                Layer {(computeLayers(resources).get(activeRes.id) || 0)} en el DAG
              </div>

              <div style={{ fontFamily: FONT, fontSize: 10, color: "#636a76", textTransform: "uppercase", marginBottom: 4 }}>
                Depende de:
              </div>
              {activeRes.dependsOn.length === 0 ? (
                <div style={{ fontFamily: FONT, fontSize: 11, color: "#636a76", fontStyle: "italic" }}>
                  Sin dependencias (nodo raiz)
                </div>
              ) : (
                activeRes.dependsOn.map((depId) => {
                  const dep = resources.find((r) => r.id === depId);
                  return (
                    <div key={depId} style={{ fontFamily: FONT, fontSize: 11, color: "#61afef", padding: "1px 0" }}>
                      {dep ? `${dep.type}.${dep.name}` : depId}
                    </div>
                  );
                })
              )}

              <div style={{ fontFamily: FONT, fontSize: 10, color: "#636a76", textTransform: "uppercase", marginTop: 8, marginBottom: 4 }}>
                Dependientes:
              </div>
              {resources.filter((r) => r.dependsOn.includes(activeRes.id)).length === 0 ? (
                <div style={{ fontFamily: FONT, fontSize: 11, color: "#636a76", fontStyle: "italic" }}>
                  Sin dependientes (nodo hoja)
                </div>
              ) : (
                resources
                  .filter((r) => r.dependsOn.includes(activeRes.id))
                  .map((r) => (
                    <div key={r.id} style={{ fontFamily: FONT, fontSize: 11, color: "#d19a66", padding: "1px 0" }}>
                      {r.type}.{r.name}
                    </div>
                  ))
              )}

              <div style={{ fontFamily: FONT, fontSize: 10, color: "#636a76", textTransform: "uppercase", marginTop: 8, marginBottom: 4 }}>
                Orden:
              </div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: "#abb2bf" }}>
                Crear: paso #{createOrder.indexOf(activeRes.id) + 1} &nbsp;|&nbsp; Destruir: paso #{destroyOrder.indexOf(activeRes.id) + 1}
              </div>
            </div>
          )}
        </div>
      </div>
    </DemoWrapper>
  );
}
