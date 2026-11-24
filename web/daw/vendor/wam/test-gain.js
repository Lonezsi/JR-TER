// test-gain.js: a tiny stand-in plugin for the tests (tests/daw/e2e-studio.mjs). It is a Web Audio Module
// in the duck-typed shape wamhost.js loads: a default export with createInstance(group, ctx, state),
// an instance with audioNode, getState() and createGui(). It halves the sound (or uses state.gain).
export default class TestGain {
  static async createInstance(group, ctx, state) {
    const node = ctx.createGain();
    node.gain.value = state && typeof state.gain === "number" ? state.gain : 0.5;
    return {
      name: "Test gain",
      audioNode: node,
      getState: async () => ({ gain: node.gain.value }),
      createGui: async () => { const d = document.createElement("div"); d.id = "test-plugin-gui"; d.textContent = "Test plugin"; return d; },
    };
  }
}
