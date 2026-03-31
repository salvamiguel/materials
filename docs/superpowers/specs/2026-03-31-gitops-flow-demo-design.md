# GitOps Flow — Demo Interactiva

**Fecha:** 2026-03-31
**Componente:** `src/components/demos/gitops/GitOpsFlow.tsx`
**Usado en:** `docs/gitops/teoria/github-actions.mdx` (sección 12)

---

## Resumen

Demo interactiva que simula el flujo completo de un despliegue GitOps, desde `git push` hasta que los pods corren en Kubernetes. Layout de pipeline vertical a la izquierda con panel de detalle a la derecha que muestra una terminal simulada con efecto typing y explicaciones contextuales.

---

## Layout

```
┌─────────────────────────────────────────────────┐
│  DemoWrapper                                    │
│ ┌──────────┬───────────────────────────────────┐ │
│ │ Pipeline │  Panel de Detalle (~70%)          │ │
│ │ (~30%)   │ ┌───────────────────────────────┐ │ │
│ │          │ │ Terminal simulada              │ │ │
│ │ ✓ Dev    │ │ (fondo #252830, monospace)     │ │ │
│ │ │        │ │                               │ │ │
│ │ ✓ Git    │ └───────────────────────────────┘ │ │
│ │ │        │ ┌───────────────────────────────┐ │ │
│ │ ● CI     │ │ Explicación + callouts        │ │ │
│ │ │        │ │                               │ │ │
│ │ ○ Reg.   │ └───────────────────────────────┘ │ │
│ │ │        │                                   │ │
│ │ ○ Config │                                   │ │
│ │ │        │                                   │ │
│ │ ○ Argo   │                                   │ │
│ │ │        │                                   │ │
│ │ ○ K8s    │                                   │ │
│ └──────────┴───────────────────────────────────┘ │
│              ┌──┐ ┌──────┐ ┌──┐                  │
│              │← │ │▶ Auto│ │ →│                  │
│              └──┘ └──────┘ └──┘                  │
└─────────────────────────────────────────────────┘
```

- **Pipeline vertical (izquierda ~30%):** Lista de 7 nodos con indicadores de estado. Cada nodo es clicable. El nodo activo tiene glow y borde iluminado. Las líneas de conexión entre nodos cambian de color según el progreso.
- **Panel de detalle (derecha ~70%):** Dos secciones — terminal simulada arriba con decoración de ventana (puntos rojo/amarillo/verde), explicación con callouts abajo.
- **Controles (abajo centrados):** Botones ← (anterior), ▶ Auto (play/pause), → (siguiente).

---

## Interacción

### Navegación manual
- Botones **←** y **→** avanzan/retroceden un paso.
- Clic en cualquier nodo del pipeline salta directamente a ese paso.
- Al cambiar de paso, la terminal se limpia y comienza la animación typing del nuevo paso.

### Auto-play (efecto typing)
- Botón **▶ Auto** activa la animación automática.
- Los comandos del usuario (líneas verdes, prefijo `$`) se "escriben" carácter a carácter (~50ms/char).
- El output del sistema (líneas grises) aparece línea completa con delay de ~150ms entre líneas.
- Las líneas de resultado (✓, checks) aparecen de golpe con delay de ~300ms.
- Al terminar todas las líneas de un paso, pausa de ~1.5s y avanza al siguiente.
- Cualquier interacción manual pausa el auto-play.
- El botón cambia a **⏸ Pausa** durante la reproducción.

### Estado del pipeline
- **Completado (✓):** nodos por los que ya se pasó — color del nodo, check verde.
- **En progreso (●):** nodo activo — pulso animado, glow, borde iluminado.
- **Pendiente (○):** nodos futuros — color gris `#636a76`.
- Las líneas de conexión entre nodos son del color del nodo completado o grises si pendiente.

---

## Los 7 pasos

### Paso 1: Developer
- **Color:** `#61afef` (azul)
- **Terminal:**
  ```
  $ git add .
  $ git commit -m "feat: add user auth"
  [main a1b2c3d] feat: add user auth
   3 files changed, 42 insertions(+)
  $ git push origin main
  Enumerating objects: 8, done.
  Compressing objects: 100% (5/5)
  Writing objects: 100% (5/5), 1.2 KiB
  To github.com:org/app.git
     f4e5d6a..a1b2c3d  main → main
  ✓ Push completado
  ```
- **Explicación:** El desarrollador hace push de su código a main. Es el único punto de entrada al sistema GitOps. Todo cambio en producción empieza con un commit.
- **Callout:** El SHA del commit (`a1b2c3d`) será la etiqueta de la imagen Docker en pasos posteriores — trazabilidad completa.

### Paso 2: Git Repository
- **Color:** `#98c379` (verde)
- **Terminal:**
  ```
  → Webhook POST github.com/hooks
  {
    "ref": "refs/heads/main",
    "after": "a1b2c3d",
    "repository": "org/app",
    "pusher": "developer"
  }
  ✓ Webhook entregado → GitHub Actions
  ```
- **Explicación:** GitHub detecta el push y envía un webhook al sistema de CI. El repositorio Git es la fuente única de verdad: si no está en Git, no existe.
- **Callout:** El campo `after` contiene el SHA del commit — GitHub Actions lo recibe como `github.sha` en el contexto del workflow.

### Paso 3: CI Pipeline
- **Color:** `#e5c07b` (amarillo)
- **Terminal:**
  ```
  ⚙ GitHub Actions — CI Pipeline
  ✓ actions/checkout@v5
  ✓ actions/setup-node@v4 (v20.11.0)
  $ npm ci
  added 847 packages in 12s
  $ npm test
  PASS  src/auth.test.ts (23 tests)
  PASS  src/api.test.ts  (19 tests)
  Tests: 42 passed, 0 failed
  ✓ CI completado — todos los tests pasaron
  ```
- **Explicación:** GitHub Actions ejecuta el pipeline CI: checkout del código, instalación de dependencias y ejecución de tests. Si algún test falla, el pipeline se detiene y no se despliega nada.
- **Callout:** Los tests son el gate de calidad. En GitOps, el CI nunca toca el clúster directamente — solo valida y construye artefactos.

### Paso 4: Container Registry
- **Color:** `#c678dd` (púrpura)
- **Terminal:**
  ```
  $ docker build -t ghcr.io/org/app:a1b2c3d .
  Step 1/5 : FROM node:20-alpine
  Step 2/5 : COPY package*.json ./
  Step 3/5 : RUN npm ci --production
  Step 4/5 : COPY . .
  Step 5/5 : CMD ["node", "server.js"]
  Successfully built 8f3a2b1c
  $ docker push ghcr.io/org/app:a1b2c3d
  a1b2c3d: digest: sha256:9e4f... size: 1789
  ✓ Imagen publicada en GitHub Container Registry
  ```
- **Explicación:** Se construye la imagen Docker y se publica en el Container Registry con el SHA del commit como tag. Cada imagen es inmutable y trazable a un commit exacto.
- **Callout:** Nunca uses tags mutables como `latest` en producción. El tag SHA garantiza que puedas saber exactamente qué código corre en cada pod.

### Paso 5: Config Repository
- **Color:** `#d19a66` (naranja)
- **Terminal:**
  ```
  $ git clone github.com:org/app-config.git
  $ cd app-config/envs/production
  $ yq -i '.spec.template.spec.containers[0].image = "ghcr.io/org/app:a1b2c3d"' deployment.yaml
  $ git diff
  -  image: ghcr.io/org/app:f4e5d6a
  +  image: ghcr.io/org/app:a1b2c3d
  $ git commit -m "deploy: app a1b2c3d"
  $ git push origin main
  ✓ Manifiesto actualizado en config repo
  ```
- **Explicación:** El CI actualiza el manifiesto de Kubernetes en el repositorio de configuración con el nuevo tag de imagen. Este es el único cambio que hace el CI en Git — no toca el clúster.
- **Callout:** La separación en dos repos (app repo + config repo) permite auditar cambios de infraestructura sin ruido de cambios de código, y dar permisos independientes a cada equipo.

### Paso 6: ArgoCD
- **Color:** `#56b6c2` (cyan)
- **Terminal:**
  ```
  ⟳ ArgoCD polling config repo...
  → Nuevo commit detectado: "deploy: app a1b2c3d"
  Comparando estado deseado vs estado actual...
  
  DIFF encontrado:
    Deployment/app-server:
  -   image: ghcr.io/org/app:f4e5d6a
  +   image: ghcr.io/org/app:a1b2c3d
  
  ⟳ Sincronizando...
  ✓ Sync completado — estado: Healthy
  ```
- **Explicación:** ArgoCD observa continuamente el config repo. Cuando detecta un nuevo commit, calcula el diff entre el estado deseado (Git) y el estado actual (clúster). Este modelo pull es clave: el clúster nunca expone endpoints al exterior.
- **Callout:** Si alguien modifica un recurso manualmente en el clúster (drift), ArgoCD lo detecta y lo corrige automáticamente en el siguiente ciclo de reconciliación.

### Paso 7: Kubernetes Cluster
- **Color:** `#e06c75` (rojo)
- **Terminal:**
  ```
  $ kubectl rollout status deployment/app-server
  Waiting for deployment rollout...
  → Pod app-server-7f8d9 (old) Terminating
  → Pod app-server-a1b2c (new) ContainerCreating
  → Pod app-server-a1b2c (new) Running
  → Pod app-server-a1b2c (new) Ready 1/1
  
  deployment "app-server" successfully rolled out
  ✓ Despliegue completado — 0 downtime
  ```
- **Explicación:** Kubernetes ejecuta un rolling update: crea los nuevos pods con la imagen actualizada, espera a que estén healthy y termina los antiguos. Zero downtime garantizado.
- **Callout:** El rolling update es la estrategia por defecto de Kubernetes. Otras estrategias como Blue/Green o Canary se verán más adelante en este módulo.

---

## Estilo visual

- **Paleta:** misma que HCLAnatomy/GHActionsAnatomy — fondo `#1e2028`, terminal `#252830`, texto `#abb2bf`.
- **Fuentes:** JetBrains Mono para terminal y etiquetas, Inter para explicaciones.
- **Terminal:** decoración de ventana (puntos rojo/amarillo/verde), título con nombre del contexto.
- **Comandos usuario:** color `#98c379` (verde), prefijo `$`.
- **Output sistema:** color `#7e8590` (gris).
- **Resultados OK:** color `#4affa0` (verde brillante), prefijo `✓`.
- **Callouts:** borde izquierdo con el color del nodo activo, fondo `#1e2028`.
- **Animaciones:** `@keyframes` para pulso del nodo activo y fade-in del panel.
- **Wrapper:** `<DemoWrapper title="Flujo GitOps" description="...">`.

---

## Estado del componente

- **Props:** ninguno — componente self-contained.
- **State:** `activeStep` (number 0-6), `isPlaying` (boolean), `typedLines` (number — cuántas líneas de la terminal actual se han revelado), `typedChars` (number — caracteres visibles de la línea actual).
- **Refs:** `useRef` para el interval del typing y el timeout entre pasos.
- **Cleanup:** `useEffect` cleanup para cancelar timers al desmontar o cambiar paso.

---

## Fuera de alcance

- No hay sonido ni efectos de audio.
- No responsive para móvil (los demos existentes tampoco lo son).
- No hay persistencia de estado entre navegaciones.
