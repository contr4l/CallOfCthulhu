class AudioController {
  enabled = false;
  private bgm?: HTMLAudioElement;
  private source = "";
  private active = new Set<HTMLAudioElement>();
  enable(value: boolean) {
    this.enabled = value;
    if (!value) {
      this.bgm?.pause();
      for (const a of this.active) a.pause();
      this.active.clear();
    } else void this.bgm?.play().catch(() => {});
  }
  music(source?: string) {
    if (!source) {
      this.bgm?.pause();
      return;
    }
    if (source === this.source) {
      if (this.enabled) void this.bgm?.play().catch(() => {});
      return;
    }
    this.bgm?.pause();
    this.source = source;
    this.bgm = new Audio(source);
    this.bgm.loop = true;
    this.bgm.volume = 0.22;
    if (this.enabled) void this.bgm.play().catch(() => {});
  }
  sfx(name: "roll" | "success" | "fail") {
    if (!this.enabled) return;
    const a = new Audio(`/media/${name}.ogg`);
    a.volume = 0.45;
    this.active.add(a);
    a.onended = () => this.active.delete(a);
    void a.play().catch(() => this.active.delete(a));
  }
}
export const audio = new AudioController();
