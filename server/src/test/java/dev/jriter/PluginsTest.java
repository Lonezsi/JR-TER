package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class PluginsTest {
    @Test void keepsGoodItemsAndDropsBadOnes() {
        String out = VersionsController.cleanPlugins(
                "[{\"kind\":\"vst3\",\"name\":\"Serum\",\"vendor\":\"Xfer\",\"uses\":2,\"installed\":false},"
                + "{\"kind\":\"bogus\",\"name\":\"Nope\"},{\"kind\":\"fl\",\"name\":\"Reeverb\"},{\"kind\":\"fl\",\"name\":\"\"},5]");
        var list = VersionsController.pluginList(out);
        assertEquals(2, list.size());
        assertEquals("{kind=vst3, name=Serum, vendor=Xfer, uses=2, installed=false}", list.get(0).toString());
        assertEquals("{kind=fl, name=Reeverb, vendor=, uses=1}", list.get(1).toString());
    }

    @Test void garbageAndEmptyGiveNothing() {
        assertEquals("", VersionsController.cleanPlugins("not json"));
        assertEquals("", VersionsController.cleanPlugins("{\"a\":1}"));
        assertEquals("", VersionsController.cleanPlugins(""));
        assertEquals("", VersionsController.cleanPlugins("[{\"kind\":\"x\",\"name\":\"y\"}]"));
        assertTrue(VersionsController.pluginList("oops").isEmpty());
    }

    @Test void capsCountAndLength() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < 300; i++) sb.append(i > 0 ? "," : "").append("{\"kind\":\"vst2\",\"name\":\"").append("n".repeat(300)).append("\"}");
        sb.append("]");
        var list = VersionsController.pluginList(VersionsController.cleanPlugins(sb.toString()));
        assertEquals(200, list.size());
        assertEquals(200, ((java.util.Map<?, ?>) list.get(0)).get("name").toString().length());
    }
}
