// test-wam2.js: a real Web Audio Module 2 plugin for the tests (tests/daw/e2e-measure.mjs). Unlike
// test-gain.js it extends the SDK's own WebAudioModule class (./sdk.js), so it checks the host
// against the real shape: groupId, descriptor, initialize(state). It is a gain: 0.5 unless
// the saved state says otherwise. initialize() is overridden because the SDK's one calls
// createAudioNode() without the state.
import { WebAudioModule } from "./sdk.js";

export default class TestWam2 extends WebAudioModule {
  constructor(groupId, ctx) {
    super(groupId, ctx);
    Object.assign(this._descriptor, { identifier: "jriter.test.wam2", name: "Test WAM 2", vendor: "JR!TER tests" });
  }
  async createAudioNode(state) {
    const node = this.audioContext.createGain();
    node.gain.value = state && typeof state.gain === "number" ? state.gain : 0.5;
    node.getState = async () => ({ gain: node.gain.value });
    node.setState = async (s) => { if (s && typeof s.gain === "number") node.gain.value = s.gain; };
    return node;
  }
  async initialize(state) {
    this.audioNode = await this.createAudioNode(state);
    this.initialized = true;
    return this;
  }
  async createGui() {
    const d = document.createElement("div");
    d.id = "test-wam2-gui";
    d.textContent = "Test WAM 2";
    return d;
  }
}
