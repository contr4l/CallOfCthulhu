import type DiceBox from "@3d-dice/dice-box-threejs";

// D100 is a tens die plus a units die; 00 + 0 represents 100.
export function physicalDiceNotation(sides: number, values: number[]) {
  if (sides === 100) {
    const tens = values.map(
      (value) => Math.floor((value % 100) / 10) * 10 || 100,
    );
    const units = values.map((value) => value % 10 || 10);
    return `${values.length}d100+${values.length}d10@${[...tens, ...units].join(",")}`;
  }
  return `${values.length}d${sides}@${values.join(",")}`;
}

export async function createDiceScene(
  host: HTMLDivElement,
  sides: number,
  values: number[],
  animate: boolean,
  complete: () => void,
  signal: AbortSignal,
) {
  const { default: Box } = await import("@3d-dice/dice-box-threejs");
  if (signal.aborted) return;
  const physicalCount = values.length * (sides === 100 ? 2 : 1);
  const box = new Box(`#${host.id}`, {
    sounds: false,
    shadows: true,
    theme_surface: "green-felt",
    theme_material: "plastic",
    theme_customColorset: {
      name: "archive-ivory",
      foreground: "#30271b",
      background: "#eadbc0",
      outline: "none",
      edge: "#b69965",
      texture: "none",
      material: "plastic",
    },
    baseScale: Math.min(88, host.clientWidth / (Math.sqrt(physicalCount) * 2.5)),
    strength: 1.1,
    light_intensity: 0.95,
    // Bound both the preview simulation and the visible replay.
    iterationLimit: 480,
  });
  let frame = 0;
  let observer: ResizeObserver | undefined;
  const resources = new Set<{ dispose(): void }>();
  function collect(mesh: DiceBox["diceList"][number]) {
    if (mesh.geometry) resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []) {
      resources.add(material);
      if (material.map) resources.add(material.map);
      if (material.bumpMap) resources.add(material.bumpMap);
    }
  }
  function render() {
    for (const mesh of box.diceList) {
      if (!mesh.body) continue;
      mesh.position.copy(mesh.body.position);
      mesh.quaternion.copy(mesh.body.quaternion);
    }
    box.renderer.render(box.scene, box.camera);
  }
  function settle() {
    const requested =
      sides === 100
        ? [
            ...values.map(
              (value) => Math.floor((value % 100) / 10) * 10 || 100,
            ),
            ...values.map((value) => value % 10 || 10),
          ]
        : values;
    // Contact timing may differ between preview and replay. Reconcile the final
    // face before revealing, using the library's own numbered-face remapping.
    box.diceList.forEach((mesh, index) => {
      collect(mesh);
      mesh.storeRolledValue("landing");
      box.swapDiceFace(mesh, requested[index]);
      mesh.storeRolledValue("receipt");
    });
    render();
  }
  function dispose() {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    box.running = false;
    box.rolling = false;
    box.scene.traverse(collect);
    Object.values(box.DiceFactory.geometries).forEach((geometry) =>
      resources.add(geometry),
    );
    Object.values(box.DiceFactory.materials_cache).forEach((entry) => {
      if (entry.composite) resources.add(entry.composite);
      if (entry.bump) resources.add(entry.bump);
    });
    resources.forEach((resource) => resource.dispose());
    if (box.renderer) {
      box.renderer.dispose();
      box.renderer.forceContextLoss();
      box.renderer.domElement.remove();
    }
  }
  signal.addEventListener("abort", dispose, { once: true });
  // Own resize and RAF lifetimes: the upstream defaults have no teardown API.
  box.resizeWorld = () => {};
  box.clearDice = () => {
    box.running = false;
    for (const mesh of box.diceList.splice(0)) {
      collect(mesh);
      box.scene.remove(mesh);
      if (mesh.body) box.world.removeBody(mesh.body);
    }
  };
  box.animateThrow = (_id, callback) => {
    if (signal.aborted) return;
    box.animstate = "throw";
    if (!animate) {
      box.simulateThrow();
      settle();
      box.running = false;
      box.rolling = false;
      callback();
      return;
    }
    let previous = performance.now(),
      accumulated = 0;
    const tick = (now: number) => {
      if (signal.aborted) return;
      accumulated += Math.min((now - previous) / 1000, 0.05) * 1.8;
      previous = now;
      let finished = false;
      while (accumulated >= box.framerate) {
        box.world.step(box.framerate);
        box.iteration++;
        accumulated -= box.framerate;
        if (box.throwFinished()) {
          finished = true;
          break;
        }
      }
      render();
      if (finished) {
        settle();
        box.running = false;
        box.rolling = false;
        callback();
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  try {
    await box.initialize();
    if (signal.aborted) return;
    box.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    observer = new ResizeObserver(() => {
      if (!signal.aborted && host.clientWidth && host.clientHeight) {
        box.setDimensions({ x: host.clientWidth, y: host.clientHeight });
        render();
      }
    });
    observer.observe(host);
    const landed = await box.roll(physicalDiceNotation(sides, values));
    host.dataset.landedFaces = JSON.stringify(
      landed.sets.flatMap((set) => set.rolls.map((roll) => roll.value)),
    );
    if (!signal.aborted) complete();
  } catch (error) {
    if (!signal.aborted) {
      signal.removeEventListener("abort", dispose);
      dispose();
      throw error;
    }
  }
}
