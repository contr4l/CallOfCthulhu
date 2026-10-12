import { test, expect, type Page } from "@playwright/test";

async function openDice(page: Page, mobile: boolean) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`model_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("model-dice-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (mobile) await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "调查员", exact: true }).click();
}

test("physical dice tumble and land on saved D6 and percentile results", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await openDice(page, info.project.name === "mobile");
  const tray = page.locator(".dice-workbench .dice-tray");
  for (const sides of [6, 100]) {
    await page.getByLabel("骰子面数").fill(String(sides));
    await page.getByLabel("骰子颗数").fill("2");
    await page.getByRole("button", { name: "设置骰子" }).click();
    // Force zero percentile faces and the 100 convention to check the model mapping.
    const values = sides === 6 ? [1, 6] : [100, 37];
    await page.route("**/api/dice/rolls", async (route) => {
      const response = await route.fetch();
      const roll = await response.json();
      await route.fulfill({
        json: {
          ...roll,
          results: values,
          total: values.reduce((a, b) => a + b, 0),
        },
      });
    });
    await page.getByRole("button", { name: "掷骰子", exact: true }).click();
    await expect(tray).toHaveClass(/is-rolling/);
    await expect(tray.locator("canvas")).toBeVisible();
    await expect(tray.locator(".poly-die strong").first()).toHaveText("…");
    const moving = await tray.locator("canvas").screenshot();
    await expect(tray).toHaveAttribute("data-renderer", "ready", {
      timeout: 15000,
    });
    await expect(tray).not.toHaveClass(/is-rolling/);
    const stopped = await tray.locator("canvas").screenshot();
    expect(moving.equals(stopped)).toBe(false);
    expect(await tray.locator(".poly-die strong").allTextContents()).toEqual(
      values.map(String),
    );
    const faces = JSON.parse(
      (await tray.locator(".dice-scene").getAttribute("data-landed-faces"))!,
    );
    expect(faces).toEqual(sides === 100 ? [100, 30, 10, 7] : values);
    await page.unroute("**/api/dice/rolls");
  }
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/dice-3d-${info.project.name}.png`,
    fullPage: true,
  });
});

test("reduced motion displays a static model and unavailable WebGL keeps the receipt", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDice(page, info.project.name === "mobile");
  const tray = page.locator(".dice-workbench .dice-tray");
  await page.getByRole("button", { name: "掷骰子", exact: true }).click();
  await expect(tray).toHaveAttribute("data-renderer", "ready");
  const before = await tray.locator("canvas").screenshot();
  await page.waitForTimeout(250);
  expect(before.equals(await tray.locator("canvas").screenshot())).toBe(true);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.includes("webgl")) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.getByRole("button", { name: "掷骰子", exact: true }).click();
  await expect(tray).toHaveAttribute("data-renderer", "fallback");
  await expect(page.locator(".dice-workbench .roll-equation")).toContainText(
    /\d+ = \d+/,
  );
  await expect(
    page.getByRole("button", { name: "掷骰子", exact: true }),
  ).toBeEnabled();
});

test("all standard polyhedra preserve their minimum and maximum faces", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDice(page, info.project.name === "mobile");
  const tray = page.locator(".dice-workbench .dice-tray");
  for (const sides of [4, 8, 10, 12, 20]) {
    await page.getByLabel("骰子面数").fill(String(sides));
    await page.getByLabel("骰子颗数").fill("2");
    await page.getByRole("button", { name: "设置骰子" }).click();
    await page.route("**/api/dice/rolls", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: {
          ...(await response.json()),
          results: [1, sides],
          total: 1 + sides,
        },
      });
    });
    await page.getByRole("button", { name: "掷骰子", exact: true }).click();
    await expect(tray).toHaveAttribute("data-renderer", "ready");
    await expect(tray.locator("canvas")).toBeVisible();
    expect(
      JSON.parse(
        (await tray.locator(".dice-scene").getAttribute("data-landed-faces"))!,
      ),
    ).toEqual([1, sides]);
    await page.unroute("**/api/dice/rolls");
  }
});

test("numbered faces remain fixed through normal and slow-frame rolls", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  let dependencyUrl = "";
  page.on("response", (response) => {
    if (
      response.url().includes("/node_modules/") &&
      response.url().includes("dice-box-threejs") &&
      response.url().includes(".js") &&
      response.ok()
    )
      dependencyUrl = response.url();
  });
  await openDice(page, info.project.name === "mobile");
  const tray = page.locator(".dice-workbench .dice-tray");
  await page.getByRole("button", { name: "掷骰子", exact: true }).click();
  await expect(tray).toHaveAttribute("data-renderer", "ready", {
    timeout: 15000,
  });
  expect(dependencyUrl).not.toBe("");
  await page.evaluate(async (url) => {
    const { default: Box } = await import(url);
    type Mesh = {
      uuid: string;
      notation?: unknown;
      geometry: { uuid: string; groups: { materialIndex: number }[] };
      material: { uuid: string } | { uuid: string }[];
    };
    type Scene = { children: Mesh[] };
    const audit = window as typeof window & {
      faceChanges: string[];
      facesObserved: number;
    };
    audit.faceChanges = [];
    audit.facesObserved = 0;
    const initialize = Box.prototype.initialize;
    Box.prototype.initialize = async function (this: {
      renderer: { render: (scene: Scene, camera: unknown) => void };
    }) {
      await initialize.call(this);
      const signatures = new Map<string, string>();
      const render = this.renderer.render.bind(this.renderer);
      this.renderer.render = (scene, camera) => {
        for (const mesh of scene.children) {
          if (!mesh.notation) continue;
          audit.facesObserved++;
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          const signature = JSON.stringify([
            mesh.geometry.uuid,
            mesh.geometry.groups.map((group) => group.materialIndex),
            materials.map((material) => material.uuid),
          ]);
          const previous = signatures.get(mesh.uuid);
          if (previous && previous !== signature)
            audit.faceChanges.push(mesh.uuid);
          signatures.set(mesh.uuid, signature);
        }
        render(scene, camera);
      };
    };
  }, dependencyUrl);
  for (const slow of [false, true]) {
    if (slow)
      await page.evaluate(() => {
        const raf = requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) =>
          raf(() => {
            setTimeout(() => callback(performance.now()), 80);
          });
      });
    for (const sides of [6, 100]) {
      const values = sides === 6 ? [1, 6] : [100, 37];
      await page.getByLabel("骰子面数").fill(String(sides));
      await page.getByLabel("骰子颗数").fill("2");
      await page.getByRole("button", { name: "设置骰子" }).click();
      await page.route("**/api/dice/rolls", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          json: {
            ...(await response.json()),
            results: values,
            total: values.reduce((a, b) => a + b, 0),
          },
        });
      });
      await page.getByRole("button", { name: "掷骰子", exact: true }).click();
      await expect(tray).toHaveAttribute("data-renderer", "ready", {
        timeout: 15000,
      });
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                faceChanges: string[];
                facesObserved: number;
              }
            ).faceChanges,
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { facesObserved: number }).facesObserved,
        ),
      ).toBeGreaterThan(0);
      expect(
        JSON.parse(
          (await tray
            .locator(".dice-scene")
            .getAttribute("data-landed-faces"))!,
        ),
      ).toEqual(sides === 100 ? [100, 30, 10, 7] : values);
      const finalFrame = await tray.locator("canvas").screenshot();
      await page.waitForTimeout(200);
      expect(finalFrame.equals(await tray.locator("canvas").screenshot())).toBe(
        true,
      );
      await page.unroute("**/api/dice/rolls");
    }
  }
});
