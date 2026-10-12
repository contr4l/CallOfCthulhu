declare module "@3d-dice/dice-box-threejs" {
  interface Disposable {
    dispose(): void;
  }
  interface Material extends Disposable {
    map?: Disposable;
    bumpMap?: Disposable;
  }
  interface Vector {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): void;
  }
  interface Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number, y: number, z: number, w: number): void;
    clone(): Quaternion;
    slerp(target: Quaternion, alpha: number): void;
  }
  interface Mesh {
    storeRolledValue(reason: string): void;
    geometry?: Disposable;
    material?: Material | Material[];
    body?: {
      position: Vector;
      quaternion: Pick<Quaternion, "x" | "y" | "z" | "w" | "set">;
    };
    position: Vector;
    quaternion: Quaternion;
  }
  export default class DiceBox {
    constructor(selector: string, options: Record<string, unknown>);
    initialize(): Promise<void>;
    roll(notation: string): Promise<{ sets: { rolls: { value: number }[] }[] }>;
    resizeWorld(): void;
    setDimensions(size: { x: number; y: number }): void;
    clearDice(): void;
    animateThrow(id: number, callback: () => void): void;
    swapDiceFace(mesh: Mesh, value: number): void;
    simulateThrow(): void;
    throwFinished(): boolean;
    running: number | false;
    rolling: boolean;
    animstate: string;
    iteration: number;
    framerate: number;
    diceList: Mesh[];
    camera: unknown;
    scene: {
      children: Mesh[];
      remove(mesh: Mesh): void;
      traverse(fn: (mesh: Mesh) => void): void;
    };
    world: { step(dt: number): void; removeBody(body: unknown): void };
    DiceFactory: {
      geometries: Record<string, Disposable>;
      materials_cache: Record<
        string,
        { composite?: Disposable; bump?: Disposable }
      >;
    };
    renderer: {
      domElement: HTMLCanvasElement;
      render(scene: unknown, camera: unknown): void;
      dispose(): void;
      forceContextLoss(): void;
      setPixelRatio(ratio: number): void;
    };
  }
}
