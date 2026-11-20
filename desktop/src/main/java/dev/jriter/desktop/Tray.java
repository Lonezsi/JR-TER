package dev.jriter.desktop;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;

/** The tray icon: Open library, Check now, Pause, Open log, Quit. */
public final class Tray {
    static Image icon() {
        BufferedImage img = new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(0x1d1d24)); g.fillRoundRect(1, 1, 30, 30, 10, 10);
        g.setColor(new Color(0xf2c14e)); g.setFont(new Font("SansSerif", Font.BOLD, 20)); g.drawString("J", 10, 23);
        g.dispose();
        return img;
    }

    public static void run(Config cfg, Log log) {
        if (!SystemTray.isSupported()) { System.err.println("No system tray here; watching without one."); return; }
        PopupMenu menu = new PopupMenu();
        TrayIcon tray = new TrayIcon(icon(), "JR!TER", menu);
        tray.setImageAutoSize(true);
        Watcher w = new Watcher(log, (kind, text) -> tray.setToolTip(("JR!TER: " + text).substring(0, Math.min(63, ("JR!TER: " + text).length()))));
        item(menu, "Open library", () -> Windows.openWindow(Config.load().server()));
        item(menu, "Check now", w::checkNow);
        MenuItem pause = new MenuItem("Pause");
        pause.addActionListener(e -> { w.pause(!w.paused()); pause.setLabel(w.paused() ? "Resume" : "Pause"); });
        menu.add(pause);
        item(menu, "Open log", () -> { try { Desktop.getDesktop().open(log.file().toFile()); } catch (IOException | RuntimeException ignored) { } });
        menu.addSeparator();
        item(menu, "Quit", () -> { w.quit(); SystemTray.getSystemTray().remove(tray); System.exit(0); });
        try { SystemTray.getSystemTray().add(tray); } catch (AWTException e) { System.err.println(e); }
        w.start();
    }

    private static void item(PopupMenu m, String label, Runnable r) {
        MenuItem i = new MenuItem(label);
        i.addActionListener(e -> r.run());
        m.add(i);
    }
}
