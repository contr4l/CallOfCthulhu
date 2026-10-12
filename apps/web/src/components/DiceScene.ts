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
    baseScale: Math.min(
      88,
      host.clientWidth / (Math.sqrt(physicalCount) * 2.5),
    ),
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
  // Record the same preview the library uses to number the dice. Replay poses
  // instead of integrating physics again, so FPS cannot change the landing.
  type Pose = [number, number, number, number, number, number, number];
  const trajectory: Pose[][] = [];
  const simulate = box.simulateThrow.bind(box);
  function capture() {
    trajectory.push(
      box.diceList.map((mesh) => {
        if (!mesh.body) throw new Error("Dice body is unavailable");
        const { position: p, quaternion: q } = mesh.body;
        return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
      }),
    );
  }
  box.simulateThrow = () => {
    trajectory.length = 0;
    capture();
    const step = box.world.step.bind(box.world);
    box.world.step = (dt) => {
      step(dt);
      capture();
    };
    try {
      simulate();
    } finally {
      box.world.step = step;
    }
  };
  function render() {
    box.renderer.render(box.scene, box.camera);
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
    if (!trajectory.length) throw new Error("Dice trajectory is unavailable");
    // rollDice has already assigned the requested numbered faces before this
    // point. Geometry and materials remain fixed throughout the visible roll.
    box.animstate = "throw";
    const last = trajectory.length - 1;
    const targets = box.diceList.map((mesh) => mesh.quaternion.clone());
    function place(index: number) {
      const before = Math.min(last, Math.floor(index));
      const after = Math.min(last, before + 1);
      const alpha = index - before;
      box.diceList.forEach((mesh, i) => {
        const a = trajectory[before][i],
          b = trajectory[after][i];
        mesh.position.set(
          a[0] + (b[0] - a[0]) * alpha,
          a[1] + (b[1] - a[1]) * alpha,
          a[2] + (b[2] - a[2]) * alpha,
        );
        mesh.quaternion.set(a[3], a[4], a[5], a[6]);
        targets[i].set(b[3], b[4], b[5], b[6]);
        mesh.quaternion.slerp(targets[i], alpha);
      });
      render();
    }
    function finish() {
      // The library reset the physics bodies for a replay. Restore the recorded
      // final pose so its result reader agrees with the last visible frame.
      box.diceList.forEach((mesh, i) => {
        const pose = trajectory[last][i];
        mesh.body!.position.set(pose[0], pose[1], pose[2]);
        mesh.body!.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
        mesh.storeRolledValue("receipt");
      });
      box.running = false;
      box.rolling = false;
      callback();
    }
    if (!animate) {
      place(last);
      finish();
      return;
    }
    place(0);
    const started = performance.now();
    const tick = (now: number) => {
      if (signal.aborted) return;
      const index = Math.min(
        last,
        Math.max(0, (((now - started) / 1000) * 1.8) / box.framerate),
      );
      place(index);
      if (index === last) finish();
      else frame = requestAnimationFrame(tick);
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
